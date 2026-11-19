// Package awake keeps the computer from going to sleep by itself while
// agents work through magpie's gateway (xiao_wang24004 on X: the computer
// went to sleep in the middle of an agent's task). With settings.KeepAwake
// on, the magpie serving the gateway holds the system's sleep off while a
// request is in flight, a Claude Code turn waits on its tool results, or a
// request ended less than Grace ago — an agent running a build or the tests
// between one request and the next — and lets go once it is idle. With
// KeepAwakeAlways it holds while magpie runs, including with no gateway.
// The system's idle sleep is held off. The display still turns off unless
// settings.KeepAwakeDisplay asks for it to stay on too (#975, Hu9956: an
// agent recording the screen to check its work found it locked), and
// closing a laptop's lid or choosing Sleep still sleeps.
//
// On a Mac it is `caffeinate -i` (-d with the display), on Windows
// SetThreadExecutionState with ES_SYSTEM_REQUIRED (and ES_DISPLAY_REQUIRED),
// on Linux `systemd-inhibit --what=idle:sleep`, whose idle inhibitor the
// desktop may or may not take for the screen too; where none is there it
// does nothing.
package awake

import (
	"context"
	"log"
	"time"

	"github.com/yetone/magpie/internal/beat"
	"github.com/yetone/magpie/internal/filememo"
	"github.com/yetone/magpie/internal/settings"
)

// Grace is how long after the last request ended sleep is still held off.
var Grace = 10 * time.Minute

// tick is how often keep looks again.
var tick = 5 * time.Second

// hold takes the system's sleep off, and with display the display's too,
// until the release it returns is called; a test stands in for it.
var hold = takeHold

// Level is how much Keep holds off.
type Level int

const (
	Off     Level = iota // nothing
	System               // the system's sleep
	Display              // the system's sleep and the display's
)

// State is what the gateway has in flight, as Keep needs to know it.
type State struct {
	Busy bool      // a request in flight or a turn waiting on tools
	Last time.Time // when the last request ended
}

// want is whether sleep is held off at now for st.
func want(st State, now time.Time) bool {
	return st.Busy || (!st.Last.IsZero() && now.Sub(st.Last) < Grace)
}

// Run applies this computer's awake settings until ctx ends. State is read
// when the settings depend on work at the gateway.
func Run(ctx context.Context, state func() State) {
	keep(ctx, func() policy {
		s := settings.Shared()
		if !s.KeepAwake {
			return policy{}
		}
		l := System
		if s.KeepAwakeDisplay {
			l = Display
		}
		return policy{level: l, always: s.KeepAwakeAlways}
	}, state)
}

type policy struct {
	level  Level
	always bool
}

// keep holds sleep off according to the current policy and gateway state.
// A level changed while held is taken anew.
func keep(ctx context.Context, current func() policy, state func() State) {
	var release func()
	held := Off
	let := func() {
		if release != nil {
			release()
			release = nil
			held = Off
			log.Print("awake: the computer may sleep again")
		}
	}
	defer let()
	failed := false
	for {
		// taken before the look, so a write made during it isn't missed
		written := filememo.Written()
		p := current()
		l := p.level
		if l != Off && (p.always || want(state(), time.Now())) {
			if release != nil && held != l {
				release()
				release = nil
			}
			if release == nil && !failed {
				r, err := hold(l == Display)
				if err != nil {
					// not there (a Linux without systemd): said once
					log.Print("awake: can't keep the computer awake: ", err)
					failed = true
				} else {
					release, held = r, l
					if l == Display {
						log.Print("awake: keeping the computer from sleeping and its display on")
					} else {
						log.Print("awake: keeping the computer from sleeping")
					}
				}
			}
		} else {
			let()
			failed = false
		}
		// turned off (as it is unless the user turns it on), only a change
		// to settings can turn it on: waited for, not looked for each few
		// seconds (#3185: these looks woke an idle magpie)
		every, changed := tick, (<-chan struct{})(nil)
		if l == Off {
			every, changed = filememo.OthersEvery(), written
		}
		select {
		case <-ctx.Done():
			return
		case <-changed:
		case <-beat.Next(every):
		}
	}
}

// NoNap keeps macOS from App Napping the magpie serving the gateway until
// the release it returns is called (#6261, ChasLui). The menu-bar app
// serves it in its own process, and with the screen locked macOS naps the
// app as one in the background: its priority falls to 4 and its timers
// wait, so the first request after a quiet while spent its 30 seconds
// before routing and got a 504. An agent waiting on the gateway is the
// user's work, so the activity says it is user initiated, as Apple's App
// Nap opt-out does. It lets the system sleep when idle, as it did: holding
// that off is Run's, and only while the user asked for it. Nor does it
// ask for NSActivityLatencyCritical's timer precision, which is for audio
// and video; a request needs the process run, not run to the millisecond.
func NoNap() func() {
	return napOff("magpie serves the gateway agents send their requests to")
}
