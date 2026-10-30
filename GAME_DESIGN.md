# Smoke Em': Game Design

Living document. Update it whenever a design decision is made or the roadmap moves.
Items marked **(proposal)** are placeholders that still need sign-off before they get built.

## Pitch

Smoke Em' is an original sci-fi first-person arena shooter that runs in a web browser. It is built
for 3 friends playing couch split-screen on an Xbox Series X in Microsoft Edge with Xbox
controllers, and it also has to be fully playable solo on a MacBook with keyboard and mouse.

It's a private game for the owner and two friends, never sold or distributed, so characters,
guns and ideas from other games are welcome, built as close to the source as we can get them
(owner, 2026-10-29). The art and sound themselves are made in code or come from CC0 sources.

## Pillars

1. **Couch first.** 1 to 4 local players in one browser tab. 60fps with 3 split-screen views in
   Edge on Xbox is the bar every feature has to clear.
2. **Fast and floaty.** High speed, low gravity, double jump. Moving around is fun on its own.
3. **Tactical meets goofy chaos.** Solid core shooting (shields, headshot-worthy rifle, map control)
   with ridiculous toys layered on top (steerable missiles, getting huge, digging underground).
4. **Readable.** Chaos is only fun if you can tell what just happened to you. Kill feed, clear
   effects, distinct silhouettes.

## Tone and setting (proposal)

A backwater off-world training facility turned combat game show. Contestants run an obstacle
course while shooting each other, and the host grades you like a pitmaster grades meat. Sci-fi
hardware (metal panels, glowing strips, a gas giant in the sky) mixed with obstacle-race junk
(wood walls, cargo nets, ropes, mud, fire).

## Visual target

Roughly early-2000s console shooter era: real-time lighting and shadows, simple textures,
low-to-mid poly geometry, saturated colors, big readable shapes. All textures are generated
procedurally in code (canvas) or come from CC0 sources. No external art pipeline for v1: the
one imported model (the contestant body, CC0) is converted by a script in `tools/` into a data
module that ships with the code.

Light: warm sun, cool sky fill, so the lit and shaded sides of every box separate. The floor is
"lightmapped" at load like a level of that era: soft contact shadows around everything standing
on it, darker under decks, damp ground around the mud and soot by the fires, and pools of
colored light under glowing strips and fires. Walls and props darken toward the floor and into
corners. Each map has its own look (sun, sky fill, fog, sky colors) in `src/world/looks.js`.

## Modes

- **Free-for-all** (v1). Timed matches, 5 minutes by default (3, 5, 10 or no limit on the
  title screen). Most points when time runs out wins.
  - Scoring: a kill is +1; smoking yourself (your own blast, the fire, falling out) is -1.
    Ties on points share a place. Training dummies (no-bot matches) give no points.
  - Each view shows the clock (red in the last 30 seconds, a beep each second for the last
    10) and everyone's place and points best first (your row highlighted) in the bottom-right
    corner, and a kill feed on the left above the motion tracker. Hold Tab (View on a
    controller) for the full scoreboard with kills and deaths.
  - The HUD is laid out and styled like Halo 3's visor (pale cyan lines and text, each corner
    tilted in a little): grenades top left, the shield bar top center (angled and segmented;
    health is a thin line under it that only shows once you've lost some), the weapon top right
    (mag count, a row of round ticks that empties as you fire, the gun's name and the other
    gun), the motion tracker bottom left, scores bottom right, and a circle on the reticle. The
    controls strip stays along the bottom (owner call: always visible).
  - Motion tracker (owner request, Halo's): a round radar in the bottom-left corner of each
    view. Enemies within 25 m show as red dots around you (the way you face is up) while they
    move faster than a sneak or for a second after they fire, then fade; standing still or
    crouch-walking keeps you off it. A dot more than 3 m above or below you is drawn as a
    ring.
  - When time runs out a horn sounds, play freezes and the results screen shows everyone's
    place, points, kills, deaths and smoked meat rank, with Play again and Quit. The pause
    menu can also end a match early (the only way to see results with no time limit).
- **Bots** (v1) for solo testing and filling out matches. Choose 0 to 7 bots and a skill level
  (Easy / Normal / Hard) on the title screen. With 0 bots, training dummies fill in.
  - Bots are regular players driven by an AI instead of a controller: same movement, same
    weapons, same damage. They run the obstacle course (nets, ropes, walls, monkey bars, mud,
    jumping the fire), grab pickups, and fight: they see within a forward cone with line of
    sight, hear gunfire within 30 m and turn toward whoever hurts them, aim with reaction time
    and wobble that settle as they track you, fire in bursts, strafe, sometimes push along
    their route while shooting, swap to the shotgun up close, throw grenades, melee, and steer
    their own Smoke Signals.
  - Bot names: Gristle, Dry Rub, Rib Tip, Pit Boss, Low n Slow, Charcoal, Flare-Up, Mop Sauce.
- **Rocky Mountain Oysters** (owner idea, 2026-10-29; PG-13 cartoon, truck-nuts style). Pick it
  under Mode on the title screen; it's free-for-all with this on top, inspired by teabagging:
  - Each kill grows a cartoon two-lobed sack hanging off the back of your belt (nothing else is
    shown), up to 12 sizes. It sways and sags as you move, and from about 9 kills it's big
    enough to drag along the floor behind you.
  - Hits on it count against you at 1.5x (a low blow). Each size slows you 3.5% (down to 72%)
    and lowers your jumps 2.5% (down to 80%), and a big one is a big target.
  - Bounty: smoking someone bigger than you is worth a bonus point ("bounty" in the kill feed).
  - Crouch three times over someone you just smoked (within 3 s, within 2.6 m) and the kill feed
    shouts "SAUCED!" and you grow a size.
  - Your size stays when you die (owner call, 2026-10-30): it only ever grows during a match.
    Bots sauce too.
- **Later:** team modes, online play between separate houses.

## The show

The arena is a game show (owner request, "game-show arena hell yeah"):
- Grandstands rise behind all four walls, packed with a cheering crowd in mixed shirt colors.
  They sway, and the stands go up (arms in the air, bouncing) on every kill, louder for a
  headshot, then settle back. A crowd roar plays with it.
- A big screen over the north stands shows "SMOKE EM' LIVE", the leader (or a tie) in their
  color with their score, the next two, and the last kill for a few seconds.
- When the horn goes, the finale: the top three stand on a gold, silver and bronze podium on
  the Summit deck, the winner (everyone tied for first) pumping both arms over their head and
  the others clapping, while confetti blasts out of two cannons and keeps raining, the crowd
  stays on its feet and the big screen says "AND THE WINNER IS" (or "IT'S A TIE!") with the
  name. A slow camera orbits the podium, full screen; the results sit on the right.

## Characters

Contestants are armored soldiers with human proportions, styled after Halo's multiplayer
Spartans: rounded plates over a charcoal undersuit (big shoulder pads, a sculpted chest and back
plate, forearm guards, thigh, knee and shin plates, heavy boots, the undersuit showing at the
backs of the knees and thighs), dark gloved fists, a thick neck seal with an armor collar, and a
Mark VI style helmet: a round shell with a big glowing gold visor set in under a brow lip and
between cheek guards, a mouthpiece with a center ridge and vents, a disc over each ear and a
ridge down the back. A smoker canister rides on the back with a glowing ember vent band. The
plates take the body's color; side panels down the torso and upper arms, the ear discs and the
helmet's back ridge take the trim color (a bot's second color, a darker shade for local
players). Thin light strips on the chest and shoulder pads glow in the body's own color, and a
rim of that color lights the silhouette, stronger with distance, so a far player reads as a
colored person even in shade. Each local player has a color: blue, red, green, gold. The body
is a CC0 model ("Futuristic 3D Soldier" by rickomax, credits in `src/player/body/CREDITS.md`),
re-weighted onto the game's skeleton with smooth joints, baked occlusion and one draw call each.
The helmet, fists, neck seal, strips and canister are our own.

Body language says what someone is doing: feet plant, legs run toward where the body is going
while the torso and gun stay on the aim (strafing and backpedaling show), the gun rides at the
hip, comes up to the shoulder when firing or zoomed and crosses the chest when sprinting (the
Smoke Signal always rests on the right pauldron), both hands hold the gun with the elbows bent
and the torso turned a little into a bladed stance (the support shoulder comes forward and the
hand slides back along the gun when the handguard is out of reach), the head and gun follow the
aim up and down, each body breathes on its own rhythm standing still, jumps tuck, the double
jump kicks a knee up, hard landings squash, and crouching is a deep squat with the hips sat
back. Whatever the pose, the helmet stays inside the hitbox's head band (from just under the
head line to the capsule top), so a shot at the visible head is a headshot.

Deaths are ragdoll-ish: a smoked body is knocked the way the hit came from (a little for bullets,
more for melee, thrown up and away by blasts, punts and flying props), tips over with its limbs
flung out and flopping, slides to a stop against the floor or a wall, lies there and puffs away
in its color just before the respawn (2.6 s). It's a visual only: nothing collides with it.

Smoked by another player, your view replays it from their eyes (a killcam): "KILLCAM" and their
name at the top, starting 1.8 s before the kill and running 2.3 s at normal speed, with their
shots drawn again (only you see those) and your body going down. The death card stays up below
it, so you can still pick your next loadout. Only bodies and shots replay; grenades, rockets and
effects show as they are now.

Character options (owner request; built 2026-10-30): besides the Spartan you can play as Crash
Bandicoot, Link or GoldenEye's Bond, each as close to the source as we can make them out of
simple shapes in the early-2000s look, on the Spartan's skeleton, so they move, aim, ragdoll and
replay like everyone else (same hitbox: the look changes, the target doesn't).
- Crash: the PS1 original (owner sent the reference, 2026-10-30): a long face running straight
  into his chest, the huge white grin cheek to cheek with the dark triangle nose in its top,
  wide eyes with black diamond pupils under heavy angry brows, tall V ears with dark insides and
  the red tuft spiking up; red-orange fur, a narrow V body with an orange stripe down the chest
  and a belly button, long skinny arms with big maroon gloves, baggy three-quarter jeans over
  skinny shins, and chunky maroon sneakers with white laces, collars and soles. (His ears, tuft
  and lower face ride the head loosely, so they don't count for the hitbox's head band.)
- Link: the long green cap over blond hair, pointed ears, the green tunic with a leather belt and
  gold buckle, cream sleeves and tights, brown boots and gauntlets, and the Hylian Shield and
  the Master Sword's purple hilt on his back.
- Bond (Brosnan in GoldenEye 007): black dinner jacket, white shirt front and collar, black bow
  tie, short dark hair with a side part.
- Your color still shows: Crash's and Link's wristbands and Bond's pocket square glow in it, and
  every body has the rim light in its color.
- Each seat picks on the join screen: LB / RB on a controller, the arrows with the mouse. The pick
  stays with the seat between matches. Bots come as a random character each match.

Palette rule: the arena owns orange, hazard yellow, cyan, brown and grey, and the local
players own blue, red, green and gold, so bots wear violets, pinks, lime and white (armor
plus a contrasting trim). The undersuit is mid charcoal so armor color and shape read.

## Players and split-screen

- 1 to 4 local players in one tab, rendered with renderer viewports and scissor.
- Layouts: 1 player full screen, 2 players stacked top and bottom, 4 players in quadrants.
- 3 players: three equal quadrants (players 1 and 2 on top, player 3 bottom left). The 4th
  quadrant is a match info panel: clock, live scoreboard, kill feed and an arena map that
  shows only the local players. Equal views are fair, and this renders 25% fewer pixels
  than a wide view on top, which matters on Xbox.
- **Joining** happens on the title screen, which shows four seats. A controller joins by
  pressing A (that press does nothing else) and leaves with B. Keyboard and mouse joins by
  clicking an empty seat, or by hitting Play with nobody joined (solo on a Mac). Seats fill
  in join order and carry over to the next match.
- Each view gets a P1 to P4 tag in its player color, and the name of whoever is under your
  crosshair shows below it.
- Any joined controller pauses for everyone (Menu, or D-pad down). For half a second after
  a pause or the results open, controllers are ignored (the others are still jumping), and
  the results buttons wait a full second. If a controller drops mid-match the game pauses;
  turning it back on, or pressing A on another controller, takes the seat back.
- Keyboard and mouse can share a match with controllers. If a controller resumes the match,
  the mouse isn't captured until the keyboard player clicks.

## Movement

Fast, floaty, generous. Current tuning lives in `src/config.js`. The speeds below are at 100%;
a **Movement speed** setting (40% to 130%, default 70%) scales running, acceleration, air
control and climbing for everyone, bots included. Jump heights never change, so every
obstacle works at any setting.

| Thing | Value (v1 starting point) |
| --- | --- |
| Walk speed | 7 m/s |
| Sprint speed | 10.5 m/s (hold, forward only) |
| Crouch speed | 3.6 m/s |
| Gravity | 16 m/s² (Earth is 9.8, most shooters run 20+) |
| Jump height | ~2.0 m |
| Double jump | ~1.6 m more, redirects your momentum |
| Air control | strong, momentum is kept when you sprint-jump |
| Player height | 1.8 m standing, 1.2 m crouched |
| Slide | starts at sprint speed +15%, about 0.9 s and 6.7 m on flat ground |
| Wall kick | up like a double jump, 6 m/s away from the wall |

- **Double jump**: one extra jump in the air. Refreshes when you land, mantle, or leap off a
  climbable. A wall kick doesn't use it.
- **Sprint**: hold. Only while moving forward and not crouched. Mud blocks sprint.
- **Crouch**: hold. On the ground it lowers you; in the air it tucks your legs so you clear
  higher ledges (crouch-jump).
- **Sprint-slide**: crouch while sprinting on the ground to slide the way you were running,
  starting 15% over sprint speed. Friction brings it down to crouch speed in about 0.9 s on
  flat ground (4.6 m at the default 70%). Slopes pull on it: down the catwalk ramp a slide
  runs the whole way, up it it lasts about half as long. Mud stops a slide in about a
  quarter second and gives no boost (on Mudlark the pit is a drop, so no slide gets there).
  - You're crouched the whole way (crouched head and camera) and steer only a little.
    Shooting works, with the spread of moving, not crouching.
  - Jumping out of a slide keeps its speed (a slide hop), but the next slide can't start
    until 1 s after the last one ended.
  - Letting go of crouch ends it early: you stand if there's room, otherwise you stay
    crouched until there is. It also ends at crouch speed, against a wall, or off a ledge,
    where you fall with its speed.
  - The view drops to crouch height, widens a little more than sprinting and rolls a touch.
- **Wall kick**: in the air within 0.4 m of a steep wall (within 30 degrees of upright),
  jump kicks off it: up like a double jump, 6 m/s away from the wall, keeping 85% of your
  speed along it. Air steering is weaker for 0.2 s after, so the push carries.
  - It doesn't use the double jump. One kick every 0.25 s at most, and not off the same
    wall twice before you touch the ground or another wall, so kicking back and forth
    between two close walls climbs them a little.
  - At most 3 kicks before you touch the ground, mantle or grab a climbable, and each one in
    a chain lifts less (85% of the upward speed of the one before), so corners can't be
    kicked up forever.
  - Pushing into any wall in reach with the double jump left, jump is the double jump
    instead, so the climbing walls (and corners) still go jump, double jump, mantle. Kick
    with the stick along the wall, away from it or let go (or into it once the double jump
    is spent).
  - Not off nets, ropes or the monkey bars (they keep their own jump), players, grenades or
    the invisible walls over the arena's edge.
- **Mantle / vault**: push forward into a ledge to pull yourself up. On the ground this vaults
  anything from knee to chest height. In the air it grabs ledges up to about hand height.
  This is how the obstacle-course walls work.
- **Climbing**: push into a cargo net or rope to grab it. Forward/back to climb, jump to leap
  off, crouch to let go. Reaching the top pulls you over the edge.
- **Monkey bars**: jump up into them to hang. Move with the stick or WASD, jump or crouch to
  drop.
- Coyote time and jump buffering so jumps feel fair.

## Health

- Regenerating shields over health.
- 100 shield + 100 health. Shields start recharging 4 s after the last hit and refill in
  about 2 s. Health regenerates too, but only once shields are full, refilling in about 4 s.
  No health pickups: on a small, fast map full regen keeps fights flowing.
- Starting values; tune in playtests.
- Environmental damage: the fire jump burns at 45 per second (through shields first), falling
  out of the map kills.
- Death: you get smoked (literally: a puff of smoke), the camera sinks and tips over, and you
  respawn after 3 seconds at the spawn point farthest from other players, with full shields,
  health and ammo.

## Weapons

Two weapon slots, both full at spawn. 19 guns in all (7 normal, 12 wacky: the original 15 plus
four the owner added), but a match only ever uses one **weapon set** of 5, so nobody has to
learn the whole roster at once. Each gun's
numbers live in its own module under `src/combat/guns/`; the full design (every gun's stats,
model, sound, bot use and counterplay) came out of a design workflow with three competing
rosters and three judges.

### Weapon sets and loadouts

- Every set is "3 to start, 2 to find": two primaries and a sidearm for loadouts, one gun on
  the field pads and one on the power pad (Mudlark: the Summit is the power pad, orange rim,
  60 s; the pads under the Summit and in the southwest barrier field are field pads, cyan
  rim, 30 s). Power guns never go in loadouts.
- A loadout is one primary plus the set's sidearm, so every set has two. You pick on the
  drop-in screen and the pause menu (arrows, or left/right on your controller) and on every
  respawn screen (A / D or the left stick); the pick sticks between lives and matches. A
  change mid-match takes effect at your next spawn, or at once if you spawned less than 3 s
  ago and haven't fired or picked anything up (an instant swap any time would be a free
  reload). Bots roll a loadout every life (Hard bots lean toward the longer-range primary).
  On the pause screen a controller's left stick changes loadouts only once you've let go of
  that controller for a moment after the pause opens (the others may still be moving, aiming
  or firing); the D-pad counts at once. Holding
  a direction changes it one step, never a flip through them.
- Loadouts show as cards: each gun's picture and a little looping demo of how it works (the
  Mesquite's pellet cone, the Smoke Signal swerving to its target, the Swarm Jar's bugs
  hunting). The ready screen's gun list shows the same pictures and demos.
- Loadout guns stay with you when you're smoked and vanish if you swap one for a pickup;
  picked-up guns drop when you're smoked (gone after 25 s).
- Heat labels say how much a set asks you to learn: Mild (the default), Medium (no wacky
  guns in loadouts), Hot, Extra Hot (anything goes; opt-in only).
- The title screen gets a Guns choice (Map default, each set, or Mystery Meat: a random set
  that's never Extra Hot and never the one just played) once more than one set is built. A
  set only appears once all five of its guns exist.
- The drop-in screen lists the set's five guns with a line on what each does.

| Set | Heat | Primaries | Sidearm | Field | Power | Status |
| --- | --- | --- | --- | --- | --- | --- |
| **Backyard** (default) | Mild | Hickory, Kindling | Toothpick | Mesquite | Smoke Signal | built |
| Competition Cut | Medium | Kindling, Cold Smoke | Toothpick | Chimney | Rotisserie | built |
| Sauce on the Side | Medium | Hickory, Kindling | Toothpick | Gust | Sauce Boss | planned |
| Bank Shot | Hot | Hickory, Wishbone | Cast Iron | Skewer | Smoke Signal | planned |
| Hot and Cold | Hot | Cold Smoke, Brander | Toothpick | Mesquite | Swarm Jar | built |
| Funhouse | Hot | Hickory, Cold Smoke | Toothpick | Portal Gun | Shrink Wrap | built |
| Hog Wild | Extra Hot | Wishbone, Brander | Cast Iron | Gust | Swarm Jar | planned |

Backyard loadouts: **Pitmaster** (Hickory + Toothpick, preselected) and **Hot n Fast**
(Kindling + Toothpick). Hot and Cold loadouts: **Ice Pick** (Cold Smoke + Toothpick,
preselected) and **Branding Day** (Brander + Toothpick).

### The guns

| Gun | Kind | Role | Built |
| --- | --- | --- | --- |
| **Hickory** | normal | Full-auto rifle, the mid-range workhorse. Long sprays bloom. | yes |
| **Mesquite** | normal | Pump shotgun: brutal up close, useless far away. | yes |
| **Smoke Signal** | wacky | Guided rocket flown from its nose camera; the power weapon. | yes |
| **Toothpick** | normal | Sidearm pistol, quick to draw: finish people off instead of reloading. | yes |
| **Kindling** | normal | SMG: fastest close-range kill, accurate on the move, weak past 25 m. | yes |
| **Cold Smoke** | normal | Marksman rifle with a 2.5x scope; three headshots smoke anyone. | yes |
| **Rotisserie** | normal | Spin-up rotary gun (power pad): huge sustained damage, slow to move. | yes |
| **Chimney** | normal | Bouncing coal launcher: small, fast blasts that flush campers. | yes |
| **Cast Iron** | wacky | Ricochet hand cannon: slugs bank off walls. | planned |
| **Skewer** | wacky | Harpoon gun: two hits kill, and a hit near a wall pins you to it. | planned |
| **Sauce Boss** | wacky | Goo lobber: slippery, slowing puddles. | planned |
| **Gust** | wacky | Leaf blower: shoves people, grenades and rockets with wind. | planned |
| **Swarm Jar** | wacky | Jar of homing bugs that chase the nearest enemy. | yes |
| **Wishbone** | wacky | Boomerang blade that cuts on the way out and back. | planned |
| **Brander** | wacky | Short-range heat beam that gets hotter the longer it's on you. | yes |
| **Shrink Wrap** | wacky | Size ray: fire shrinks, the aim button grows (see below). | yes |
| **Portal Gun** | wacky | Portal's portal gun: a blue and an orange portal you walk, fall and shoot through (see below). | yes |
| **Stickybomb Launcher** | wacky | TF2's: sticky bombs that cling to walls, floors and ceilings, set off together with the aim button (see below). | yes |
| **Gravity Gun** | wacky | Half-Life 2's: grab and fling loose things, including other people's grenades and stickies (see below). | yes |

**Stickybomb Launcher** (owner pick, 2026-10-29, TF2's). Fire lobs a sticky bomb; up to 6 can
be out at once (a 7th sets off your oldest), stuck to walls, floors or ceilings where they first
land (not to people), each armed after 0.7 s. The aim button sets all your armed ones off (95
damage each, 3.6 m). Your own blast knocks you around, so sticky jumps work. Your bombs fizzle
when you're smoked. Bots' stickies go off by themselves when someone steps near one.

**Gravity Gun** (owner pick, 2026-10-29, Half-Life 2's). The aim button grabs the loose thing
nearest your aim (within 12 degrees and 14 m, in sight) and holds it floating in front of you;
the button again drops it, fire throws it at 30 m/s. It grabs the loose props, briquettes, Chimney
coals and sticky bombs (stuck ones come off), and whatever you grab is yours from then on, so its
blast or hit counts for you. Fire with nothing held punts: everyone within 5 m in front is shoved
back and takes 14, and loose things there fly off. No ammo. A thrown prop hurts the first body it
hits hard (up to about 75), once per throw; a propane tank goes off when a thrown one hits
anything hard or a blast catches it. Matches with the Gravity Gun get the props: a crate, a
barrel and a propane tank around every pickup pad, back 25 s after they're lost or blown up.
They're physics objects like grenades, so people and bullets pass through them. Not in yet:
catching Smoke Signal rockets and Swarm Jars.

**Junkyard** (Hot): Hickory and Stickybomb Launcher primaries ("Pitmaster" and "Sticky Ribs"),
the Toothpick, the Mesquite on the field pads and the Gravity Gun on the power pad.

**Shrink Wrap** (owner request, 2026-10-29: one gun for both; built). A 1950s ray gun, the power
gun in the Funhouse set, never in a loadout. Its hitbox change is the point: a shrunk player
really is harder to hit (the collider, head line and camera all scale).
- Fire shrinks for 6 s: 40% size, 80% speed, 75% jumps, your shots (and blasts) do half damage,
  the view drops to ankle height, and anyone who comes down on you smokes you with a stomp
  ("stomped" in the feed).
- The aim button grows for 6 s (the gun has no scope): 160% size, 85% speed, takes 1.5x damage,
  and a second grow while still big pops you ("Shrink Wrap (popped)"). Growing needs room: a
  grow under a low ceiling fizzles.
- Shrinking someone big or growing someone small puts them back to normal; another shrink on
  someone small restarts their 6 s. The ray does no damage of its own and has 8 zaps (either
  way), no reserve. Cyan for shrink, pink for grow; the body morphs over a quarter second.
- Your view shows SHRUNK or SUPERSIZED with the seconds left. Bots pick it up like any power gun
  and only shrink.

**Portal Gun** (owner request, 2026-10-29: "a portal gun like from the game Portal", as close to
the source as we can get; rules signed off 2026-10-30; built). On the field pads in Funhouse,
a pickup only (never in a loadout), no ammo. Bots leave it alone.
- It looks like Portal's handheld portal device: white casing, black core, three black prongs at
  the front around a pale glowing core, with a stripe in your armor color.
- Fire opens the blue portal and the aim button the orange one: ovals about 1.2 m x 2 m with
  glowing rims, on any flat wall, floor or ceiling with room for them (not mud, nets, ropes,
  belts or the invisible walls over the perimeter). A shot near an edge slides the portal to fit
  if it can; otherwise it fizzles. Shooting a color again moves it. Floor and ceiling portals
  point away from you.
- Every player's pair is blue and orange, with a thin outer ring in the owner's armor color, and
  your two link to each other. Your crosshair shows a blue and an orange oval, filled while that
  portal is open.
- A wall portal with floor under it (within 2.5 m) settles down onto the floor like a doorway, so
  wherever you hit the wall you can walk into it, and any part of your body going in counts
  (owner report: portals shot a little high couldn't be walked through).
- Anyone goes through anyone's linked portals, and speedy thing goes in, speedy thing comes out:
  your speed turns with you (at least 3 m/s out of the exit) and so does your view. Walk into a
  wall portal, fall into a floor one, or stand on a floor one and drop through.
- Bullets go through (up to three portals, and yes, you can shoot yourself), and so do rockets
  (the pilot's view turns with them), grenades, coals, sticky bombs, props, Swarm Jars and bugs.
- Portals close when you're smoked.
- Each portal shows a low-resolution picture of what's out of the other one, refreshed a few
  times a second (Medium and High; Low shows only the swirl). It's a picture, not a window: it
  doesn't shift as you move.

**Shooting rules for every gun**
- Hold the trigger to repeat at the gun's own rate (semi-autos too, so nobody has to mash).
- Spread blooms while firing and only starts recovering 0.15 s after the last shot, so a
  long spray really widens and short bursts stay tight.
- Each gun can set its own switch time (the Toothpick comes up in 0.25 s, the default is
  0.4 s), how long firing blocks sprint, and its tracers.
- Firing cancels sprint. You can shoot while climbing nets, ropes and monkey bars (with extra
  spread), but not mid-mantle. Bullets pass through cargo nets.
- An empty gun swaps itself out for your other one.

**Built gun stats** (tune in playtests; time to kill is against 100 shields + 100 health):
- **Hickory**: 9/s, 13 damage, heads x1.5, falls to 60% between 35 and 80 m, 32 + 160,
  1.7 s reload, 1.35x zoom. Bloom caps at 3.1 degrees hip-fire after about 13 rounds.
  1.67 s body, 1.11 s heads.
- **Mesquite**: pump, 10 pellets x 12 in a 6 degree cone, falls to 15% between 6 and 18 m,
  6 + 18, one shell at a time. Two point-blank blasts smoke.
- **Smoke Signal**: 1 + 1 rockets, 2.4 s reload; 15 to 25 m/s, turn cap 2.8 rad/s, 7 s life;
  blast 5.5 m, full 210 inside 1.6 m (a direct hit always smokes); hurts you too.
- **Toothpick**: 4/s, 20 damage (30 heads), falls to 65% between 25 and 55 m, 12 + 48,
  1.2 s reload, 1.25x zoom, 0.25 s draw. 2.25 s body, 1.5 s heads.
- **Kindling**: 14/s, 10 damage, falls to 40% between 10 and 28 m, 40 + 200, 1.5 s reload,
  barely affected by moving or jumping, sprint again 0.15 s after firing. 1.36 s inside 10 m.
- **Cold Smoke**: 2/s, 45 damage (67.5 heads), 8 + 32, 2.1 s reload, 2.5x scope (no gun on
  screen, a scope reticle instead), 2.6 degrees from the hip, 0.21 scoped and standing, much
  worse in the air. Long icy tracers point back at the shooter. 2.0 s body, 1.0 s heads.
- **Chimney**: 1.4/s, 3 + 9 glowing coals loaded one at a time (0.55 s each, firing
  interrupts). Launched at 26 m/s plus a little lift; they bounce, trail embers and burst on
  touching anyone (you're safe for the first 0.25 s) or after 1.1 s. Blast 3.2 m, 85 inside
  0.4 m, hurts you too. Field pads respawn it every 40 s.
- **Rotisserie**: hold the trigger 0.5 s to spin up (no ammo used, everyone hears it), then
  18/s, 8 damage, falls to 50% between 25 and 60 m, 100 + 100, 3 s reload, 0.7 s draw.
  Spinning drops you to 60% speed with no sprint; the barrels take 1 s to stop, and pulling
  again meanwhile only needs the windup that's left. 1.33 s to smoke once spun.
- **Brander**: hold for an exact beam out to 22 m (no spread, no headshots, no falloff), 20
  pulses a second. 50 damage a second on a new target, climbing 100 a second while you stay
  on them up to 150 (1 s in); slipping off for up to 0.25 s holds the heat (it only climbs
  while the beam is on them), longer or a new target starts over. 100 damage by 1 s, 1.67 s to smoke. 4 s per cell (80 pulses, 3 spare
  cells), 1.8 s vent. The beam tapers from the gun and turns from orange to white-hot as it
  heats, so its victim sees it coming. Burns a bug swarm out of the air in 0.3 s.
- **Swarm Jar**: lobs a jar (18 m/s plus lift, 15 on a direct hit) that smashes on whatever
  it touches and lets out a swarm. 1 + 2 jars, 1.4 s reload, power pad every 60 s. The swarm
  hunts the nearest enemy it can see within 15 m (never its thrower), flying at 80% of
  sprint speed (so sprinting away works for a while), latches on within 1 m and stings 30 a
  second for the rest of its 6 s (about 170 if ignored). It never latches through walls or
  floors and can't pass through them. It dies to its victim's melee, fire, any explosion it's
  inside, 0.3 s of anyone else's Brander beam, or 30 damage of anyone else's gunfire passing
  close (three Hickory rounds); a swing aimed right at a free swarm in reach knocks it out
  too. At most 4 swarms at once. Its stings don't move your damage arrow (it would point at
  the thrower). Bots only lob jars inside 20 m (a jar reaches about 25 m), one per sighting
  while chasing.

**Sounds**: real CC0 recordings: AK-47 (Hickory), Benelli Nova (Mesquite), Walther PPQ
(Toothpick), Carl Gustav M45 (Kindling), SKS (Cold Smoke), Mossberg 190 slowed down
(Chimney), slices of a PPSh-41 burst (Rotisserie, with a synthesized spin whine). See `src/audio/samples/CREDITS.md`.
The Brander's sizzle and vent and the Swarm Jar's cork pop, glass smash and buzz are
synthesized.

**Pickups**
- Weapon pads hold the set's field gun and power gun (see above), plus four grenade pads with
  2 each (20 s): the catwalk, the net block, the west monkey-bar platform and the northwest
  crates.
- Walking over a pickup takes it when it fits: a gun you already carry tops up its ammo,
  grenades fill up to the max. A different gun gets a prompt: press E (hold X on a
  controller) to swap it for the gun in your hands.
- Every pad sends up a soft light column in its rim color while its pickup is up, so you can
  see across the arena which ones are ready: a tall orange one for the power gun that clears
  the walls, a mid-height cyan one for field guns, a short ember one for grenades. Columns fade
  out when you stand next to them, and their lower part fades while someone stands on the pad
  (so that player's armor color still reads; the short grenade column goes out). An empty pad shows a ring that fills like a clock
  until its pickup is back, then pulses.

### Grenades and melee

- **Briquette** grenade: start with 2, carry up to 4. Thrown hard (20 m/s plus a lift) with next
  to no drag in the air, so aiming higher throws further, as in Halo (about 13 m flat, 26 m at
  30 degrees up); from its first bounce it drags and settles. It blows up 2.4 s after the throw,
  or, if it's still in the air then, a third of a second after it lands. Blast: 5 m radius, full 130 damage
  within 1 m. Solid cover between you and a blast blocks it. Blasts shove people and other
  grenades, shake nearby cameras, and hurt the thrower.
- Every blast flashes white, rolls fire that cools from yellow to red into dark smoke, and
  shows a shock ring out to its real damage radius, so you learn how close is too close: flat
  along the ground in the open, facing you when cover would cut it short. It leaves a scorch
  that fades after 30 s.
- **Tenderizer** melee: 65 damage at up to 2.3 m. Anyone up to 3.6 m in front pulls you into a
  quick lunge. Hits from behind smoke instantly. 0.9 s cooldown.

## Vehicle: the Sizzler

Owner ask (2026-10-30): a one-player motorcycle with guns on it, on the Valhalla-style map
(Smokehouse Creek), and bots smart enough to use it. One parked by each smokehouse.

- **Getting on and off**: walk up to it, E (or hold X). Same again to get off; you hop off to
  whichever side has room. While riding there are no grenades, melee, pickups or reloads.
- **Driving**, Halo style: the bike turns toward where you look (mouse or right stick), and A / D
  (or the left stick) also steer it directly. W / S (stick forward and back) is throttle, brake
  and reverse. Shift (left stick click) boosts from a tank that refills. Space (A) hops.
  Top speed 15 m/s, 21 boosting; the creek slows it to 6. Hills slow it a little going up and
  speed it going down; anything steeper than about 38 degrees stops it like a wall, and it gets
  air off ramps and crests at speed. It leans into turns and tips with the ground. It runs over
  training dummies too.
- **Twin guns** under the bars, firing in turn (9 rounds a second, 12 damage each, 70 m). They
  swing a little off the bike's heading. Hold the trigger too long and they overheat for 2 s
  (the HUD's ticks are the heat; the number is the hull).
- **Chase camera**: third person, behind and above, looking a touch below the aim so the bike is
  in view; the reticle sits above the middle, on the guns' line.
- **The hull**: 280 points, no shields, no regen. Destroyed, it blows up (a grenade-sized blast)
  and takes the rider with it, credited to whoever finished it. The rider stays hittable and
  takes 75% damage.
- **Splatter**: running into someone at 10 m/s or more smokes them; slower, it hurts and shoves.
- **Respawn**: back in its spot 30 s after it's destroyed, or after 40 s left empty away from it.
- **Bots**: now and then a roaming bot walks to a free bike in reach and gets on. Riding, it drives
  routes a bike can take (no climbs), makes strafing runs on whoever it sees (guns on them while
  the bike arcs past), drives straight at them up close, eases off the trigger before the guns
  overheat, backs out when stuck, and gets off when the hull's nearly gone mid-fight or after a
  while with nobody around.

## Abilities (later)

- **Dig**: go under the map for about 10 seconds. You can see enemies but stay hidden, then pop
  up anywhere.
- **Ground Pound**: jump and slam down like a stone, damaging whoever you land on.
- **Coin Bash**: hit trees and objects to knock out coins. Coins make you bigger, tougher and
  stronger.
- **Get Huge**: become giant. More damage, but worse vision and easier to hit.
- **Grapple**: fire at almost any surface and zip to it.
- **The Stall** (proposal name; the idea came in as "Neo mode"): for about 3 seconds, any shot
  that would hit you stops dead in mid-air about a meter in front of you, hanging there as a
  glowing slug. Missiles and grenades freeze too. When it ends, the stalled rounds drop to the
  ground (proposal; a spicier variant flings them back at whoever fired them). Shots are
  hitscan, so this works as a bubble the shot ray checks before it hits you.

How abilities are earned (loadout, pickup, cooldown, charge from kills) is an **open question**.

## Ranks

End-of-match rank based on performance, all smoked meats, worst to best:

1. Hot Dog
2. Smoked Chicken
3. Pulled Pork
4. Smoked Salmon
5. Brisket
6. Wagyu Burnt Ends

Rank comes from a performance score between 0 and 1 that blends finishing place and K/D, so
a last-place player with a good K/D isn't automatically a Hot Dog:

- `place = (N - p) / (N - 1)` where `p` is finishing place (1 = winner) among all `N`
  participants, bots included. 1 for the winner, 0 for last. A solo match counts as 1.
- `kd = min(1, (kills / max(1, deaths)) / 2)`, so a K/D of 2 or better maxes out.
- `score = 0.6 * place + 0.4 * kd`
- The score splits into six equal bands: below 1/6 is Hot Dog, 5/6 and up is Wagyu Burnt Ends.

Examples: winner with K/D 2+ gets Wagyu Burnt Ends; winner with K/D 1 gets Brisket; last place
with K/D 1.5 gets Smoked Chicken.

## Maps

### Map 1: Mudlark Gauntlet (name is a proposal)

A small (60 m x 60 m) obstacle-race course arena inside tall metal walls. Every obstacle doubles
as combat terrain.

- **The Summit** (center): a 6 m tower deck on legs with a solid core underneath for cover.
  A-frame cargo nets on the north and south sides climb to the top. Too high to reach with a
  plain double jump; skilled players can get there from the crate just west of it (jump,
  double jump at the top of the arc, then push forward to grab the edge).
- **Climbing walls** (west lane): three walls of 1.3 m (vault), 2.6 m (jump and mantle) and
  4.4 m (double jump and mantle).
- **Mud pit** (east): a sunken pit. Mud halves your speed, weakens jumps and blocks sprint.
- **Monkey bars** (east): span the mud pit between two platforms. Hang and cross, or fall in.
- **Fire jump** (north): burner troughs with flames to leap over. Burns (once health exists).
- **Rope climb** (south): three ropes up to a high catwalk along the south wall. A ramp at the
  east end is the slow way up.
- **Net block** (northeast): a 5 m block with a vertical cargo net on its face.
- Crates, barriers and low walls scattered for cover.

### Map 2: Smokestack Works (name is a proposal)

Owner pick (2026-10-30): an indoor factory. A smokehouse plant turned game-show arena: a 60 m x
44 m hall under a trussed roof with three open skylight bands (the sun comes through in bright
stripes; the rest is warm bounce light, a smoky haze and pools under hanging lamps). The crowd
sits in stands above the two long walls, and a four-sided jumbotron hangs over the middle.
Tight, multi-level, built for close fights: its default set is Junkyard (stickies, the Gravity
Gun and plenty of crates and barrels to throw).

- **The Smoker** (center): a giant black smoker, 5 m tall, with glowing firebox doors east and
  west and burning grates in front of them (the fire jump). Its deck has the power pad, smoke
  stacks at the corners for cover and railings, open north and south where the bridges arrive.
  Skilled players can get up from the crate stack just southwest of it. The finale's podium
  stands on it.
- **Catwalks**: along both long walls at 5 m, stairs at one end and a ladder at the other (climbed
  like a rope), with a bridge from each to the smoker's deck.
- **Conveyor belts**: two lines across the hall, running east on the north side and west on the
  south side (2 m/s). Standing on one carries you along. Each ends in a smoke hood.
- **Pallet racks** (west): three rows of orange racks full of crates, with aisles between them and
  a field pad in the middle aisle. Their tops (3.6 m) take a double jump and a mantle.
- **Grease vat** (east): a sunken vat that works like the mud (slow, weak jumps), with a hook rail
  across it (monkey bars) between two loading docks.
- Presses, crates and drums for cover; pipes and high windows on the end walls.

### Map 3: Smokehouse Creek (name is a proposal)

Owner pick (2026-10-30): Halo's Valhalla shape. A 100 m x 64 m grass valley under a big
afternoon sky, rimmed by steep slopes. Wide open, long sight lines, built for the field guns and
(later) the Sizzler: its default set is Competition Cut.

- **The smokehouses** (west and east ends): one on each plateau, 3 m above the valley. Doors on
  every side, a smoker with a glowing firebox on the porch, a smokestack, and a roof deck with a
  parapet reached by a ramp on the south side. The west one has orange strips, the east one
  cyan. Grenades on each roof.
- **Launch pads**: one in front of each smokehouse. Step on it and it throws you out over the
  valley to land by the creek (about 1.75 s in the air, no steering), like Valhalla's man
  cannons.
- **The creek** (north to south down the middle): wade it (it slows you like the mud), cross on
  one of two plank bridges, or hop the stepping stones to the island in the middle, where the
  power gun sits.
- **The hills**: one on each flank (northwest and southeast), with a field gun on top and boulders
  for cover, plus low rises and scattered crates, drums and barriers.

The title screen has a Map choice: Mudlark, Smokestack, Creek or Random (a different map each match,
never the same one twice in a row). Guns on "Map default" use each map's own set.

## Controls

### Keyboard and mouse (any seat)

| Action | Key |
| --- | --- |
| Move | WASD (or arrow keys) |
| Look | Mouse / trackpad (pointer lock) |
| Jump / double jump / wall kick | Space |
| Sprint | Shift (hold) |
| Crouch (slide from a sprint) | C (hold) |
| Fire | Left mouse |
| Zoom / aim | Right mouse |
| Reload | R |
| Pick up / interact (get on or off a Sizzler) | E |
| Grenade | G |
| Melee | Q or F |
| Switch weapon | Mouse wheel or X, or 1 / 2 for a slot |
| Scoreboard | Tab |
| Pause | Esc |
| Toggle FPS counter | ` (backquote) |

Never bind gameplay to Ctrl or Cmd on Mac (see CLAUDE.md).

### Xbox controller

| Action | Button |
| --- | --- |
| Move / look | Left stick / right stick |
| Jump / double jump / wall kick | A |
| Crouch (slide from a sprint) | B (hold) |
| Reload | X (tap) |
| Pick up / swap weapon on the ground, get on or off a Sizzler | X (hold) |
| Switch weapon | Y |
| Fire | RT |
| Grenade | LT |
| Melee | RB |
| Ability (later) | LB |
| Sprint | Left stick click (stays on until you let off forward or crouch) |
| Zoom | Right stick click (toggle) |
| Pause | Menu, or D-pad down |
| Scoreboard (hold) | View |

- Menus: D-pad or left stick moves, A selects, B goes back, left/right changes sliders and
  choices.
- Sticks have a radial deadzone. Look runs on a curve (fine aim near center) with a turn
  boost after a moment at full tilt, so you can still spin around. Full tilt is about
  180 degrees per second before the boost.
- Controller aim assist, Halo style (controllers only, never mouse or bots):
  - Every gun sets its own assist, like Halo's: how wide the cone is (6 to 10 degrees at most,
    and about 30 to 50 cm past the body's edge) and its range (14 m for the Mesquite, 26 for the
    Kindling, 45 to 50 for rifles and the Toothpick, 110 for the Cold Smoke). Zoomed, the cone
    shrinks by the zoom, so it stays the same size on screen.
  - The reticle turns red exactly when assist is on someone: inside the cone, in range, in sight
    (with a mouse, when the crosshair is right on them in range). Past a gun's range it never
    goes red and nothing bends.
  - Slowdown: look slows to about 50% while assist is on someone and to 72% just around them.
  - Magnetism: a shot inside the cone bends onto the nearest point of the body, so aiming at the
    head still gets the head. Spread and bloom still apply after the bend, so spraying still
    misses.
  - Tracking: while you're moving a stick with assist on someone, the view follows 30% of how
    fast they cross it, so a strafing target doesn't slide straight off the reticle. No lock-on.
- Rumble when you get hurt, smoked, or shaken by a blast (can be turned off).
- Edge on Xbox treats B as the browser's Back button, so once a controller shows up the game
  keeps a spare history entry and B can never leave the page.

## Settings

- Map: Mudlark, Smokestack, Creek or Random (title screen).
- Graphics quality: Low / Medium / High (resolution cap, shadows, anti-aliasing).
- Movement speed for everyone, players and bots (default 70%).
- Mouse sensitivity (saved to `localStorage`).
- Controller look speed and controller vibration.
- Invert Y, field of view (default 78, Halo's), head bob, FPS counter toggle.
- These are shared by every local player for now; per-player settings can come later.

## Audio

- Guns, reloads and explosions are real recordings, all CC0 (credits in
  `src/audio/samples/CREDITS.md`). The Hickory is an AK-47 (four takes, picked at random),
  the Mesquite a Benelli Nova 12 gauge with a real pump rack after every shot, explosions
  are cannon and firework bangs over a synthesized sub-bass thump.
- UI and body sounds (hit markers, kill confirm, shields, hurt, melee, grenade bounces) stay
  synthesized with WebAudio.
- Sounds live in the world: other players' guns fade and lose their highs with distance from
  the nearest local player, guns and blasts ring off the arena walls (a generated echo that
  gets relatively louder far away), and with one local player sounds pan left and right.
  Your own sounds always play up close.
- Hit markers, hurt and shield sounds play only for local players, not for bots fighting
  each other.

## Roadmap

### Phase 0: Setup (done)

- GAME_DESIGN.md and CLAUDE.md.
- Vite + Three.js + Rapier scaffold, GitHub Pages deploy via GitHub Actions.

### Phase 1: Version 1 (small playable steps)

1. **Arena + movement (done)**: the obstacle-course arena, one player on keyboard and mouse,
   sprint, crouch, double jump, mantle, nets, ropes, monkey bars, mud. Main menu with quality,
   sensitivity, FOV and FPS settings. Pause menu. Shader warm-up at load.
2. **Shooting (done)**: Hickory rifle with a first-person viewmodel, hitscan with headshots,
   spread, reload and zoom; shields and health with regen; fire jump damage; death and
   respawn; HUD (vitals, ammo, hit markers, kill confirms, death screen); placeholder sounds;
   six training dummies (standing and strafing) as practice targets.
3. **Full arsenal (done)**: Mesquite shotgun, Smoke Signal guided missile (missile camera),
   weapon pickups on the map, grenades, melee, explosions with knockback and camera shake,
   permanent on-screen controls.
4. **Bots (done)**: bots that run the obstacle course and fight, bot count and skill on the
   title screen, a damage-direction arrow on the HUD.
5. **Match flow (done)**: free-for-all rules, match timer, kill feed, respawns, hold-to-view
   scoreboard, end-of-match results with smoked meat ranks.
6. **Split-screen + controllers (done)**: 1 to 4 local players, Gamepad API, press A to
   join, full controller navigation of every menu, the 3-player info panel.
7. **Xbox pass**: performance tuning on Edge on Xbox with 3 views, placeholder sounds, polish.

### Phase 2: More game

- **More weapons**: 15 guns in 6 weapon sets (in progress, one set per PR; see Weapons).
- **Graphics pass** (owner wants this): still the early-2000s console look, just better made.
  Candidates: richer procedural textures with normal maps, baked ambient occlusion on the
  arena, fog and a better sky, more detailed character bodies with real walk, run, jump and
  climb animation, first-person gun animations, better muzzle flashes, explosions and impacts.
  Every change is measured against the Xbox budget (60 fps with 3 views) from step 7, so the
  two go together. A design workflow (three competing plans, two judges) turned this into 15
  PRs, biggest visible win per frame cost first: (1) groundwork: `?bench`, draw-call savings,
  sharper shadows (done); (2) readable contestants: team-color rim light, glowing visors, a
  bot palette that avoids arena colors, chunkier armor (done); (3) world light: baked ground shading
  and glow pools, contact shading on walls and props, a light grade per map (done); (4) shots you
  can read: third-person muzzle flashes, tracers that stay visible far away, combat cues (done);
  (5) painted sky and skyline (done); (6) textures 2.0 (done); (7) body language: real locomotion, aiming
  separate from legs, jumps and landings (done); (8) pickup beacons (done); (9) explosions, impacts and
  decals (done); (10) arena dressing (done); (11) first-person feel (done); gun models 2.0 (done: see the decision log); (12) climbing, reload, throw, melee,
  flinch and death animation (done); (13) animated reloads in first person (done); (14) normal maps on
  high only (done); (15) a shadowless low tier only if the Xbox bench needs it.
- **More maps** (owner wants this): Map 2, Smokestack Works, Map 3, Smokehouse Creek, and the
  map choice are done.
  Each new map needs its own layout, bot links (`src/ai/mapLinks.js`), pickup pads and a
  default weapon set, registered in `src/world/maps.js`.
- Abilities, team modes. (The motorcycle, the Sizzler, is done: see Vehicle.)

### Phase 3: Online

- Online play between separate houses.

## Open questions

Need answers before the step that uses them gets built.

1. **How abilities are earned.** Needed for phase 2.
2. **Names.** Weapon, map and vehicle names above are proposals.

## Decision log

- 2026-10-28: 3-player split-screen uses equal quadrants with a match info panel in the 4th.
- 2026-10-28: Health regenerates after shields are full; no health pickups.
- 2026-10-28: Ranks come from a 60/40 blend of finishing place and K/D.
- 2026-10-29: Headshots deal 1.5x on every hit (shields up or down). Shooting allowed while
  climbing with extra spread; firing cancels sprint.
- 2026-10-29: Training dummies stay in as practice targets for solo play until bots arrive.
- 2026-10-29: All controls are shown permanently along the bottom of each view (owner's call).
- 2026-10-29: Two weapon slots; auto pick up into an empty slot, E to swap when full; you drop
  picked-up guns when smoked. Grenades: start 2, max 4.
- 2026-10-29: Explosions hurt their owner, and a direct Smoke Signal hit always kills.
- 2026-10-29: Owner found 100% movement way too fast: added a Movement speed setting,
  default 70%.
- 2026-10-29: Bots get three skill levels (not in the original brief; cheap and useful for
  solo testing). Training dummies only appear with 0 bots.
- 2026-10-29: Next up after bots: step 6 (controllers and split-screen) so the Xbox is
  playable, then the owner's picks: art and animation pass, abilities, the motorcycle, more
  maps. Step 5 (match flow) slots in alongside.
- 2026-10-29: Controller layout built as proposed, with sprint and zoom as stick-click
  toggles (holding a stick click while aiming is awkward). Pause is Menu or D-pad down,
  because Edge on Xbox may keep Menu for itself.
- 2026-10-29: Controllers get light aim friction (60% look speed with someone under the
  crosshair) and nothing stronger. Keyboard and mouse get none.
- 2026-10-29: Seats: A joins and B leaves on the title screen; keyboard and mouse joins by
  clicking a seat or playing solo. Settings stay shared across local players for now.
- 2026-10-29: Owner asked for more realistic gun sounds: guns, reloads and explosions are now
  CC0 recordings (The Free Firearm Sound Library and others from OpenGameArt), with distance
  falloff, muffling, panning and an arena echo. Bots' personal sounds (hit markers, hurt) no
  longer play.
- 2026-10-29: Match length is a title-screen choice (3, 5, 10 minutes or no limit, default
  5); Pause has End match. Ties on points share a place.
- 2026-10-29: Owner wants everyone to spawn with two guns and to pick loadouts. Next PR:
  three new guns (Toothpick pistol, Cold Smoke marksman rifle, Kindling SMG), a default
  loadout of Hickory + Toothpick, and loadouts picked per player on the respawn screen.
- 2026-10-29: Weapon roster (owner asked for about 15 guns, normal and wacky, but a small
  set per map): 15 guns in 6 sets of 5, Backyard the default; loadouts are a primary plus
  the set's sidearm; spawn with both slots full; loadout guns never drop. Built in one PR
  per set. Proposals still waiting on the owner: kill credit for hazard deaths within 4 s of
  being hit, Cast Iron ricochets hurting their shooter, the Gust glide, the "Basted" status,
  all gun and set names.
- 2026-10-29: Every gun repeats when the trigger is held; bloom waits 0.15 s after the last
  shot before recovering (it never built up before), and the Hickory is retuned to match.
- 2026-10-29: Review fixes for the weapons framework: fire cooldowns carry leftover time
  between ticks so every gun fires at its stated rate (fast guns were rounding down to whole
  ticks); the Smoke Signal needs a fresh pull (a trigger held through an auto-swap no longer
  launches it); a direction held when you're smoked doesn't change your respawn loadout;
  aim zoom is applied after the field-of-view clamp, so the 2.5x scope really is 2.5x and
  zoom works in 2-player split views. Bots reload guns they put away dry once a fight is
  over, pick guns by meters from each gun's preferred range (so they swap both ways, shotgun
  up close included), and give up their sidearm rather than their primary at pickups.
- 2026-10-29: Competition Cut is the second set (Chimney coal launcher, Rotisserie spin-up
  rotary gun). The controls strip only shows the missile hint when the set has the Smoke
  Signal.
- 2026-10-29: Owner wants new maps and better graphics in the plan; both are now explicit
  Phase 2 items (the graphics pass goes with the Xbox performance pass).
- 2026-10-29: Hot and Cold is the third set (Brander heat beam, Swarm Jar homing bugs).
  Bots holding the Swarm Jar lob it at your last-seen spot while chasing; Normal and Hard
  bots swat bugs on them, Easy bots run. The swarm's bugs were made bigger than the spec's
  "tiny" so a swarm reads from across a fight, and the beam tapers toward the gun so it
  doesn't fill the shooter's own screen.
- 2026-10-29: Graphics pass planned (see Roadmap, Phase 2). Groundwork first: a `?bench` page
  for real numbers on the Xbox, then savings that pay for the new look: the sky draws after
  the arena, empty effect pools and pickups cost no draw calls, all glow strips share one
  material, the shadow map is fitted 1.7x tighter (sharper shadows everywhere). Solo views
  went from 50 to about 38 draw calls. Waiting on the owner: the bot color palette, a warmer
  light grade and a facility skyline beyond the walls.
- 2026-10-29: World light (graphics PR 3). The light grade went in with the shade side kept
  as bright as before (bluer sky fill at higher intensity, warmer sun at the same brightness);
  it's one block in `looks.js` if the owner wants it changed. The floor bake costs no draw calls
  and two shader programs; it runs once per map and quality (about 90 ms headless, cached for
  rematches).
- 2026-10-29: Shots you can read (graphics PR 4). Other players' guns flash when they fire
  (tinted per gun), tracers race from the gun you see in their hands and never thin below
  about 1.6 px, a broken shield pops with a cyan ring, and a death puff carries the victim's
  armor color. Fuse blink, low-health smoke and spawn flashes were left out until the owner
  wants them.
- 2026-10-29: Textures 2.0 (graphics PR 6) went ahead of the sky PR, which waits on the owner's
  sign-off for the facility skyline. Surfaces are 512 px (256 on Low) with painted relief:
  metal walls in 1 m x 2 m panels with worn edges, grime and a little rust, pebbly ground with
  hairline cracks, cast concrete with tie holes, knotted planks, chipped crates. Stenciled
  numbers on walls and boot prints were dropped: on a 4 m tile they show the repeat.
- 2026-10-29: Pickup beacons (graphics PR 8). Columns are soft on purpose so a player on a pad
  still reads; they partly cover what's behind them so the orange one stays orange against the
  bright sky instead of washing out to white. Halos around the cyan and orange wall strips are
  on Medium and High only. Together they cost one draw call per view and no shadow pass draws.
- 2026-10-29: Booms and marks (graphics PR 9). Bullet hits throw sparks off metal, chips off
  dirt and concrete, splinters off wood and splats in mud, and leave small marks that fade after
  15 s (none on mud, nets or ropes). Marks and scorches are off on Low. Shots now stop at the
  mud's surface instead of going through it to the pit floor (missiles and jars too), since
  the mud is what you see. No new meshes or shader programs; the trough embers keep the
  existing sparks and smoke draws on between fights.
- 2026-10-29: Loadout cards (owner request): gun pictures and little demos of how each gun works,
  on the drop-in, pause and respawn screens; the loadout can be changed any time (next spawn,
  or at once right after spawning). Queued after it: movement (sprint-slide, wall kick), the new
  bodies, ragdoll-ish deaths, a death replay from the killer's view, the game-show arena, maps,
  then the Shrink Wrap and the Portal Gun.
- 2026-10-29: Owner: "i'm not going to make any money on this or distribute it so in general
  stick as close to the source material as possible". The portal gun is now Portal's (blue and
  orange, the device's look), and the character options are Crash Bandicoot, Link and James Bond
  rather than lookalikes.
- 2026-10-29: Loadout cards review. The death card shows only the gun pictures (its live demos
  cost 1 to 2 ms a frame across 3 views), and with reduced motion each demo stops on a telling
  moment. A teammate still strafing when someone pauses no longer changes their loadout with
  the stick (see Weapon sets and loadouts).
- 2026-10-29: New soldier body (graphics). The owner picked the CC0 OpenGameArt soldier from a
  three-way bake-off and asked for it to look closer to Master Chief, so the tool builds a Mark
  VI style helmet with a big gold visor on it, plus baked occlusion, a neck seal, thicker arms
  and gloved fists. The rig keeps the helmet inside the head band in every pose (it wasn't
  before: looking straight down or mid-stride dropped it under the head line). About 21% more
  triangles per body than the prototype, one draw call each as before; the Xbox `?bench` is
  still to be run. The bladed stance with two-handed guns is a style call the owner can undo.
- 2026-10-29: Owner ideas queued: Rocky Mountain Oysters mode (right after movement), the
  Stickybomb Launcher and Gravity Gun (a new set after it), a Halo motion tracker and everyone's
  scores on every view (being built now).
- 2026-10-29: Owner asked for a Halo motion tracker and everyone's scores on every view. The
  tracker follows Halo's rules (25 m, moving or firing shows you, sneaking doesn't); the
  standings list replaced the "1st · 3" line under the clock.
- 2026-10-29: Owner asked for the movement ideas: sprint-slide and wall kick (see Movement),
  built from the proposal with every number in `src/config.js` for the owner to tweak. One
  change to it: jumping while pushing into a wall with the double jump left is still the
  double jump, otherwise the climbing walls (jump, double jump, mantle) would kick you off
  them, for bots too. Also decided while building: a kick never lowers how fast you're
  rising, air steering is weaker for 0.2 s after a kick (strong air control undid the push
  at once), slopes pull a slide 1.5x gravity's own pull so downhill really speeds up, and a
  downhill slide tops out at 1.6x sprint speed. After review, kick chains got a limit:
  mashing jump in a corner kicked up it without end and out over the invisible walls, so a
  chain is now 3 kicks, each lifting less, and the invisible walls can't be kicked off (a
  chain behind the net block still reaches its top). Bots don't slide or kick on purpose
  yet; a Hard bot's random jump next to a wall kicks now and then, with no effect on their
  routes in testing. The body has a sliding flag and a wall-kick counter to animate later.
- 2026-10-29: Rocky Mountain Oysters built. A first look hung big sacks on a long stretched cord,
  which read as something else entirely, so the sack now always hangs straight off the belt
  and just gets bigger and saggier (dragging comes from size). It's one draw call per view.
- 2026-10-29: Owner approved a Halo feel pass, next after Oysters: bullet magnetism for
  controllers only (overriding the earlier "no magnetism or auto-aim" rule), stronger aim
  slowdown, a retuned stick curve, snappier ground acceleration and chasing the one 42 ms hitch
  seen on the Mac bench.
- 2026-10-29: Halo feel pass. Controller aim assist now has magnetism and a wider slowdown (see
  Controls), and ground movement is snappier: faster acceleration and stopping, and pushing
  against the way you're moving turns you around 1.5x faster. The stick curve stays as it was
  until the owner has played with the rest. The 42 ms hitch seen once on the Mac bench didn't
  reproduce headless; the Xbox bench will say whether it's real.
- 2026-10-29: Stickybomb Launcher and Gravity Gun built, in a new Junkyard set. The loose props
  don't block people or shots (they're physics objects like grenades, which every movement and
  shot check skips); making them solid would mean reworking those filters, left for later if
  the owner wants it. Catching rockets and jars with the Gravity Gun is left out of this first
  version.
- 2026-10-29: Ragdoll-ish deaths. A cheap fake rather than a physics ragdoll: the body tips over
  as one piece about its feet with a procedural limp pose (flailing while thrown), one floor and
  wall check per corpse per frame and no extra draw calls. The death puff moved from the moment
  of death to when the body disappears. Bodies that fall out of the world still just vanish.
- 2026-10-29: Death replay (killcam). Every rendered frame records each body's and bone's
  transforms and each player's eye and aim into a ring of about 3 s; a replaying view copies
  the past onto the bodies, renders, and puts the present back. Replaying views render after
  live ones so the shared shadow pass sees the present. Kills by yourself, fire or falling
  don't replay.
- 2026-10-29: Game-show stands and big screen. The stands are looks only (no collision, no
  shadows) and merge into the arena's existing meshes; the crowd (about 770 people) is one
  instanced mesh animated in its vertex shader and the screen a canvas texture redrawn only when
  the scores change: two draw calls per view, none in the shadow pass. gfx switch `show`.
- 2026-10-29: The finale (confetti and podium). Built only when a match ends (its shaders are
  warmed up at load), it takes over the screen from the split views: one full-screen camera, no
  HUDs. Everyone not on the podium is hidden. Confetti is one instanced mesh of 600 pieces moved
  on the CPU, which is fine with gameplay over.
- 2026-10-30: Map 2 is an indoor factory (owner's pick): Smokestack Works (see Maps). Its
  default set is Junkyard. New mechanic: conveyor belts carry whoever stands on them. The roof
  is looks only (an invisible ceiling stops rockets and blasts), so the floor bake and the bots'
  map don't see it. The hall costs about the same draw calls as Mudlark (headless bench, 3
  views: 111 a frame on both). While building it, the bots' nav graph stopped making "drop"
  edges straight down through a walkway's own floor (it only checked the step off, not the
  fall), which helps Mudlark's catwalk too.
- 2026-10-30: Shrink Wrap built as specced, in a new Hot set, Funhouse (Hickory and Cold Smoke
  primaries, Toothpick, Mesquite on the field pads as a stand-in for the Portal Gun, the Shrink
  Wrap on the power pad). Decided while building: 8 zaps a pickup, no reserve; shrinking someone
  big or growing someone small puts them back to normal; a shrunk player's blasts are halved
  too, not just bullets.
- 2026-10-30: Rocky Mountain Oysters fix (owner report: sacks floating around unattached). Your
  own sack now hides in your own view like your body does, and the killcam replays the sacks
  with the bodies instead of drawing them where people are now.
- 2026-10-30: Owner: grenades should go further when you aim higher, as in Halo. They had heavy
  air drag (losing over half their speed a second), so a high lob stalled and fell short of a
  flat one. Now almost no drag until the first bounce, a faster throw (20 m/s), a fuse that waits
  for a long lob to land, and bots lob with the arc solver.
- 2026-10-30: Portal Gun rules signed off (anyone can use anyone's portals, shots go through,
  pickup only) and built, on Funhouse's field pads. The owner asked for a picture of the other
  side instead of the plain swirl: each portal shows a low-frame-rate snapshot from its exit
  (one portal refreshed every 6 frames on Medium, 3 on High, all in one atlas texture). Character
  options: picked on the join screen, Link (not Princess Zelda) and GoldenEye-era Bond.
- 2026-10-30: Owner couldn't grab with the Gravity Gun by clicking fire. Fire with nothing held now
  grabs what's under the crosshair (unless someone is close in front: then it punts them); fire
  again throws; the aim button still grabs and drops, as in Half-Life 2. The ammo line says
  "Fire or aim grabs" / "Fire throws · aim drops".
- 2026-10-30: Owner said guns and characters look worst and matter most, so the graphics pass
  turns to them, guns first. Every gun is rebuilt from a small shape kit (chamfered boxes, round
  barrels with dark bores, raked grips, curved mags, tapered stocks and muzzles) and the first-person
  material now shines by finish: metal reflects the sky and ground, wood has grain, glow parts light
  themselves. Same models in the loadout pictures and on pickups; bodies carry a lighter version
  (about 12% more vertices per body). Draw calls unchanged. Next: gloves with fingers, then the
  characters.
- 2026-10-30: Overnight queue (owner said go): gloves and first-person feel, character
  animation, character detail, arena dressing, smarter bots, one PR each. First up: gloves with
  fingers and thumbs wrapped on every grip, arms that reach off screen, mags that drop out while
  the support hand fetches a fresh one, the pump racking under the hand, a springier sway, a lean
  when strafing and a breath when still.
- 2026-10-30: Character animation (overnight step 2). Other players now visibly reload (gun rolled
  over, hand to the belt), wind up and sling grenades, swing the gun butt in a melee, flinch away
  from hits, climb hand over hand with the gun slung on their back, and buckle at the knees when
  shot down. Movements are exaggerated a little so they read across the arena; flinches stay
  inside the headshot band.
- 2026-10-30: Character detail (overnight step 3). Bodies went from flat Lambert to Phong with a
  shine per part: the Spartan's painted plates catch highlights, its metal more, and the gold visor
  reflects the sky like curved glass; Crash's nose and eyes, Link's buckle, shield rim and hilt, and
  Bond's shoes, hair and tie shine too; undersuits and cloth stay matte. Guns on bodies take their
  finish (metal shines, wood doesn't).
- 2026-10-30: Arena dressing (overnight step 4). Mudlark got sponsor boards between the wall
  buttresses, TV cameras on tripods at the corners of the wall tops, drum smokers puffing on the
  wall tops and cable runs along the foot of the side walls. Smokestack got strings of smoked
  sausages hanging from the trusses, gauges on the pipe drops, hazard warning boards on the end
  walls and pallet stacks in the two free corners (the only new cover). No new materials, so no new
  draw calls.
- 2026-10-30: Smarter bots (overnight step 5). Bots with the Gravity Gun grab a nearby prop and
  fling it at you from range (and switch away when there's nothing left to throw); they walk into
  anyone's linked portals when the exit is much nearer where they're going; in Oysters they go back
  and crouch for SAUCED; and grenades come when they pay off (someone camping, a crowd, an empty
  gun, or a lob at where you just ducked behind cover) instead of at random. Bots still don't place
  portals themselves.
- 2026-10-30: Owner: the guns look a lot better; next, improve the environment graphics. First:
  normal maps on High. The relief pass that already shades each surface texture by its height
  canvas now also writes a normal map from the same slopes, so seams, rivets, planks and pebbles
  answer the real sun (metal walls got a little more shine to catch it). No draw calls; one more
  shader program; about 0.3 s more texture painting on the first High load (cached after).
- 2026-10-30: Owner picked the facility skyline for Mudlark (over keeping the desert alone).
  Past the stands now: hazy arcology towers with lit window bands, six smokestacks with red and
  white bands and pale smoke plumes, comm towers with dishes, hangars, four flood rigs aimed at
  the arena, blinking aviation lights, and a monorail on stilts circling the arena with a train
  going round; the mesas and gas giant stay behind it all. The sky got the sun's glow and a
  drifting band of clouds. Everything fades into the horizon haze with distance. About 3 draw
  calls per view (gfx switch `skyline` for the Xbox bench).
- 2026-10-30: Atmosphere for Smokestack: soft sunbeams slant down through every skylight bay to
  the floor along the real sun, with dust drifting in them (Medium and High only; beams fade
  right in front of the camera so walking through one doesn't flash the screen). Two draw calls.
- 2026-10-30: Ground detail. Mudlark's dirt got rubble piled along the foot of the walls and
  pebbles across the field (low-poly rocks tinted to the dirt, kept off pickup pads, dummy posts,
  the mud pit and the Summit; you walk through them) and damp, trodden patches baked into the
  floor. Smokestack's floor got a hazard-striped keep-clear border round the smoker, dashed lane
  lines along the belts, drains and tire scuffs. No new draw calls.
- 2026-10-30: Owner asked what makes Halo 3 look so good and queued the three biggest gaps:
  real reflections, shield shimmer and bloom. Reflections first: the arena is captured into a
  small cube map at load, and armor, visors and gun metal reflect it (blurry on plates, sharp on
  the visor glass) instead of a sky-and-ground gradient. No per-frame cost.
- 2026-10-30: Shield shimmer, Halo's way: a hit on shields flares the body gold, brightest at the
  edges, with energy bands rippling up it; a break bulges the shell out in a white-gold pop and the
  burst of shards is gold too (it was cyan).
- 2026-10-30: Bloom on High, the last of the three Halo-look items: glow strips, lamps, fire,
  explosions, muzzle flashes, shield flares and the sky by the sun bleed light. About ten passes a
  frame (not per view); the Xbox bench decides whether it stays on High (gfx switch `bloom`).
- 2026-10-30: Owner sent a Halo 3 screenshot and asked what would make ours feel closer. The gap
  is mostly framing and art direction, so three passes were queued: framing, a color grade and a
  HUD restyle. Framing first: every first-person gun is pulled in big, close and low on the right
  with the barrel nearly level (one framing block over all the guns' own poses), zooming no
  longer pulls the gun in toward the middle, the default field of view went from 95 to 78
  (anyone who never changed it gets the new default), muzzle flashes are bigger, and the
  Hickory, Kindling and Rotisserie show their mag count on a small glowing screen on the gun
  (orange when low).
- 2026-10-30: Owner asked for Halo's walking feel in the same pass: the view now bobs with each
  step (it dips at every footfall and sways toward the planted foot, softer when zoomed; a Head
  bob setting turns it off) and everyone's footsteps are heard, by surface (concrete, metal,
  dirt, wood, mud) with a faint armor rattle. Sneaking while crouched is silent, matching the
  motion tracker, and hard landings thud.
- 2026-10-30: Owner: in Rocky Mountain Oysters your size should stay when you die instead of
  popping back to small. It now only grows during a match (so the bounty point goes to whoever
  smokes someone with more kills).
- 2026-10-30: Halo look, the color grade (second of the three passes): less color, a cooler
  white, more contrast, shadows lifted toward blue, and bright light rolled off to white, so the
  sky blows out pale at the horizon and distant walls sit in a bright haze. Each view's eye
  adapts: stand under a roof or a catwalk and the exposure opens up over about a second; step
  back out and the world is blown out for a moment, then settles. No extra passes on Low and
  Medium (the grade runs inside the materials); on High the bloom composite does it.
- 2026-10-30: Halo look, the HUD (last of the three passes): Halo 3's layout and visor styling
  (see Match flow above). The plan included hiding the controls strip after the start of a
  match; the owner wants it always visible, so it stays and the bottom corners sit above it.
- 2026-10-30: Owner: the footsteps were annoying and should sound like Halo's. The synthesized
  clicks are gone; footsteps are now CC0 recordings (stone, sand and metal-boot takes) pitched
  down and low-passed into soft, heavy thuds with a sub-thump and a faint armor jingle, and your
  own steps sit lower in the mix than other people's.
- 2026-10-30: Owner queued every remaining Halo graphics item: a grit pass, chunkier guns,
  bulkier Spartans, sun lens flare and outdoor god rays, glowing projectiles, and a third map.
  Owner picks: map 3 is Valhalla-style (two rival smokehouses facing each other across a creek
  valley, hills, a launch pad), and the guns get chunky Halo proportions, darker gunmetal and
  more glowing parts while keeping their wood grips, smoker parts and orange accents. Owner also
  asked for the one-seat motorcycle with mounted guns (the Sizzler) on the Valhalla map.
- 2026-10-30: Grit pass: concrete walls get damp patches, rust weeping from the tie holes, rain
  streaks and cracks; metal panels get soot, streaks and scraped paint; factory floors ground-in
  dirt. On top, every level surface gets grime patches and streaks laid by world position, so
  the dirt doesn't repeat with the textures (two texture lookups, no draw calls).
- 2026-10-30: Chunky guns (owner pick: Halo proportions, keep the BBQ parts): every gun is 20%
  thicker about its bore line with its lengths kept, the gunmetal is darker, and each gun's main
  body has an ember-orange glowing strip down each side. Wood grips, shells, smoker parts and the
  orange accents stay. First person, bodies, pickups and the loadout pictures all match.
- 2026-10-30: Bulkier Spartans: the armor is pushed out (up to about 3.5 cm on the chest and
  pauldrons, less on the limbs, a little on the undersuit), so they read big at range like
  Halo's. The helmet and hands stay put, and the hitbox is unchanged.
- 2026-10-30: Owner asked for up to 8 players with bots in solo play (already there: 0 to 7 bots
  on the title screen) and for bots that can use the vehicles (part of the motorcycle work).
- 2026-10-30: Sun lens flare and god rays on Mudlark: look toward the sun and a glare with a
  string of colored rings and hexagons runs through the view (Medium and High), fading when a
  wall passes in front; on High the sun's light also streams in rays past whatever stands in
  front of it. About one draw call and one small pass.
- 2026-10-30: Glowing projectiles: briquettes glow like hot coals, Chimney coals deeper orange,
  sticky bombs red (pulsing once armed), and the Smoke Signal's motor bright, each leaving a short
  light trail while it flies, like Halo's plasma grenades. Sparks only, no new draw calls.
- 2026-10-30: Map 3 is Valhalla-shaped (owner's pick): Smokehouse Creek (see Maps). Two rival
  smokehouses on plateaus at the ends of a grass valley, a creek down the middle with two bridges
  and stepping stones, a hill on each flank, and a launch pad in front of each base that throws
  you to the creek (the bots path through them too). The ground is one terrain mesh and collider,
  shaded by slope and wetness. Default set Competition Cut. Fewer draw calls than Mudlark.
- 2026-10-30: The Sizzler (owner ask: a one-player motorcycle with guns for the Valhalla-style
  map, and bots that use it). Two of them on Smokehouse Creek. Halo-style handling (it turns
  toward your view), twin overheating guns, boost and hop, splatter, a hull that blows up with
  the rider, a chase camera with the reticle above the middle, and bots that board, drive, make
  strafing runs and bail. Riders take 75% damage so a rider isn't just a bigger target. About 2
  draw calls per view (frames and wheels, instanced).
- 2026-10-30: Feel research (Halo 3; owner asked for all five follow-ups). First, aim assist like
  Halo's: per-gun cones and ranges, cones that shrink with zoom, a red reticle that turns on
  exactly when assist engages (and never past the gun's range), and a little tracking on a
  strafing target while you're aiming.
- 2026-10-30: The Sizzler got stuck on hills and in the creek (owner report). It now floats its
  collision ball over the ground and rides on a ground probe, so slopes up to about 38 degrees,
  the creek's banks and terrain creases don't catch it; it gets air off crests at speed.
- 2026-10-30: Fixed Smokehouse Creek's smokehouses, which had several pieces mirrored the wrong way:
  the roof ramp now climbs the south side from near the back to a landing at the front corner and
  the roof's gap (it used to rise out toward the creek to a platform in mid air), the side doors
  are near the front inside the walls (the walls used to stick out past the front), and the
  smoker, the porch and the smokestack are where they belong (inside, in front, on the roof).
- 2026-10-30: Dynamic resolution (feel research, Halo 3 gave up pixels for a steady frame rate):
  when frames run long, the render scale steps down instead of the frame rate dropping, and
  creeps back up when there's room. On by default; the FPS counter shows it.
