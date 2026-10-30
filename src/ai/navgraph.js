import * as THREE from 'three';

// Bot navigation for the current map, built at load from the physics world.
//
// Nodes: standable spots on a 2 m grid, on every floor level (ground, platforms, the Summit
// deck, the catwalk...), found by casting down repeatedly through each column.
// Edges are classified by what the move takes:
//   walk        flat ground, ramps and stairs
//   drop        stepping off something higher
//   jump        jump up onto something (a mantle catches the ledge)
//   doublejump  same, for ledges a single jump can't reach
//   firejump    walking across a fire trough, so jump it
// Map links add the obstacle-course moves the grid can't see: walls, nets, ropes, bars.

const GRID = 2;
// The sampled area (half sizes, meters) and the height the column casts start from, unless the
// map sets its own (arena.nav: { halfX, halfZ, top }).
const HALF = 29;
const TOP = 14;
const NO_ROT = { x: 0, y: 0, z: 0, w: 1 };
// Obstacles are priced cheap on purpose: bots should run the course, not avoid it.
// (A launch pad throws you far for nothing: walking onto it is all it takes.)
const TYPE_COST = { walk: 1, drop: 1, jump: 1.6, doublejump: 2.6, firejump: 4, over: 1.2, net: 1.2, rope: 1.3, bars: 0.9, launch: 0.4 };

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();

export class NavGraph {
  constructor(game, links = []) {
    this.game = game;
    const { RAPIER, world } = game.physics;
    this.world = world;
    this.filter = game.shotFilter;
    this.notBody = game.notBody;
    this.ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });
    // A bit thinner than a player so nodes can sit close to walls.
    this.standShape = new RAPIER.Capsule(0.5, 0.36);
    this.sweepShape = new RAPIER.Capsule(0.45, 0.33);
    this.nodes = [];
    this.cells = new Map();
    const nav = game.arena.nav ?? {};
    this.halfX = nav.halfX ?? HALF;
    this.halfZ = nav.halfZ ?? HALF;
    this.top = nav.top ?? TOP;
    const t0 = performance.now();
    this.sampleNodes();
    this.connect();
    for (const link of links) this.addLink(link);
    this.buildMs = performance.now() - t0;
  }

  key(ix, iz) {
    return ix * 1000 + iz;
  }

  // ------------------------------------------------------------ nodes

  sampleNodes() {
    const zones = this.game.zones;
    const feet = new THREE.Vector3();
    for (let x = -this.halfX; x <= this.halfX; x += GRID) {
      for (let z = -this.halfZ; z <= this.halfZ; z += GRID) {
        for (const y of this.floorsAt(x, z)) {
          if (!this.standable(x, y, z)) continue;
          feet.set(x, y, z);
          if (zones.inFire(feet, 1.8, 0.4)) continue;
          const node = { id: this.nodes.length, x, y, z, ix: (x + this.halfX) / GRID, iz: (z + this.halfZ) / GRID, mud: zones.inMud(feet), edges: [] };
          this.nodes.push(node);
          const k = this.key(node.ix, node.iz);
          if (!this.cells.has(k)) this.cells.set(k, []);
          this.cells.get(k).push(node);
        }
      }
    }
  }

  // Every upward-facing surface in a column, top to bottom.
  floorsAt(x, z) {
    const out = [];
    let y = this.top;
    for (let i = 0; i < 40 && y > -1.5; i++) {
      const hit = this.castDown(x, y, z, y + 1.5);
      if (!hit) break;
      if (hit.timeOfImpact < 0.01) {
        // Started inside something solid: step down through it.
        y -= 0.3;
        continue;
      }
      const fy = y - hit.timeOfImpact;
      if (hit.normal.y > 0.7 && fy > -1.2) out.push(fy);
      y = fy - 0.05;
    }
    return out;
  }

  castDown(x, y, z, dist) {
    const r = this.ray;
    r.origin.x = x;
    r.origin.y = y;
    r.origin.z = z;
    r.dir.x = 0;
    r.dir.y = -1;
    r.dir.z = 0;
    return this.world.castRayAndGetNormal(r, dist, true, this.filter, undefined, undefined, undefined, this.notBody);
  }

  standable(x, y, z) {
    _a.set(x, y + 0.92, z);
    return this.world.intersectionWithShape(_a, NO_ROT, this.standShape, this.filter, undefined, undefined, undefined, this.notBody) === null;
  }

  // Sweep a slightly lifted capsule (bottom at `lift` above the floor) from a to b.
  sweepClear(ax, ay, az, bx, by, bz, lift = 0.35) {
    const off = 0.45 + 0.33 + lift;
    _a.set(ax, ay + off, az);
    const vel = { x: bx - ax, y: by - ay, z: bz - az };
    if (Math.abs(vel.x) + Math.abs(vel.y) + Math.abs(vel.z) < 1e-4) return true;
    const hit = this.world.castShape(_a, NO_ROT, vel, this.sweepShape, 0, 1, true, this.filter, undefined, undefined, undefined, this.notBody);
    return hit === null;
  }

  // ------------------------------------------------------------ edges

  connect() {
    const zones = this.game.zones;
    const feet = new THREE.Vector3();
    for (const a of this.nodes) {
      for (let dx = -1; dx <= 1; dx++) {
        for (let dz = -1; dz <= 1; dz++) {
          if (!dx && !dz) continue;
          const list = this.cells.get(this.key(a.ix + dx, a.iz + dz));
          if (!list) continue;
          for (const b of list) {
            const type = this.classify(a, b);
            if (!type) continue;
            let t = type;
            if (t === 'walk') {
              // Crossing a fire trough on foot? Jump it.
              for (let s = 1; s < 4; s++) {
                const k = s / 4;
                feet.set(a.x + (b.x - a.x) * k, a.y + (b.y - a.y) * k, a.z + (b.z - a.z) * k);
                if (zones.inFire(feet, 1.8, 0.35)) t = 'firejump';
              }
            }
            this.addEdge(a, b, t);
          }
        }
      }
    }
  }

  classify(a, b) {
    const dy = b.y - a.y;
    const dh = Math.hypot(b.x - a.x, b.z - a.z);
    const gentle = Math.abs(dy) <= 0.45 || Math.abs(dy) / dh <= 0.8;
    if (gentle && Math.abs(dy) < 1.8) {
      return this.sweepClear(a.x, a.y, a.z, b.x, b.y, b.z) ? 'walk' : null;
    }
    if (dy < 0) {
      // Step off horizontally at our height, then fall (with nothing, like the deck we're on,
      // in the way).
      if (dy <= -7 || !this.sweepClear(a.x, a.y, a.z, b.x, a.y, b.z)) return null;
      return this.sweepClear(b.x, a.y, b.z, b.x, b.y, b.z, 0.05) ? 'drop' : null;
    }
    if (dy <= 5.0) {
      // Room to rise straight up, then room to move over onto the ledge.
      const up = this.sweepClear(a.x, a.y, a.z, a.x, b.y, a.z, 0.05);
      const over = up && this.sweepClear(a.x, b.y, a.z, b.x, b.y, b.z);
      if (!over) return null;
      return dy <= 3.4 ? 'jump' : 'doublejump';
    }
    return null;
  }

  addEdge(a, b, type, extra = null) {
    if (a.edges.some((e) => e.to === b.id && e.type === type)) return;
    const dist = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
    const cost = dist * (TYPE_COST[type] ?? 1) * (b.mud ? 3 : 1);
    a.edges.push({ to: b.id, type, cost, ...extra });
  }

  addLink(link) {
    const a = this.nearest(_a.set(...link.a), 2.5, 1.2);
    const b = this.nearest(_b.set(...link.b), 2.5, 1.2);
    if (!a || !b) {
      console.warn('nav link has no nearby node', link);
      return;
    }
    const extra = { jumps: link.jumps ?? 0, mid: link.mid ?? null };
    this.addEdge(a, b, link.type, extra);
    if (link.twoWay) this.addEdge(b, a, link.type, extra);
  }

  // ------------------------------------------------------------ queries

  // Closest node to a point, preferring the same floor level.
  nearest(p, maxDist = Infinity, maxDy = 2.5) {
    let best = null;
    let bestD = maxDist * maxDist;
    for (const n of this.nodes) {
      const dy = n.y - p.y;
      if (dy > maxDy || dy < -maxDy - 1) continue;
      const d = (n.x - p.x) ** 2 + (n.z - p.z) ** 2 + dy * dy * 4;
      if (d < bestD) {
        bestD = d;
        best = n;
      }
    }
    return best;
  }

  // A* from node to node with a binary heap and buffers reused between searches.
  // Returns a list of { node, type, edge } steps (excluding the start).
  findPath(start, goal) {
    if (!start || !goal) return null;
    if (start === goal) return [];
    const N = this.nodes.length;
    if (!this.g || this.g.length !== N) {
      this.g = new Float32Array(N);
      this.came = new Int32Array(N);
      this.seen = new Uint32Array(N);
      this.via = new Array(N);
      this.heap = [];
      this.gen = 0;
    }
    const { g, came, seen, via } = this;
    const gen = ++this.gen;
    const nodes = this.nodes;
    const h = (n) => Math.hypot(n.x - goal.x, n.y - goal.y, n.z - goal.z);
    const heap = this.heap;
    heap.length = 0;
    const push = (id, f) => {
      heap.push([f, id]);
      let i = heap.length - 1;
      while (i > 0) {
        const parent = (i - 1) >> 1;
        if (heap[parent][0] <= heap[i][0]) break;
        [heap[parent], heap[i]] = [heap[i], heap[parent]];
        i = parent;
      }
    };
    const pop = () => {
      const top = heap[0];
      const last = heap.pop();
      if (heap.length) {
        heap[0] = last;
        let i = 0;
        for (;;) {
          const l = i * 2 + 1;
          const r = l + 1;
          let m = i;
          if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
          if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
          if (m === i) break;
          [heap[m], heap[i]] = [heap[i], heap[m]];
          i = m;
        }
      }
      return top;
    };
    seen[start.id] = gen;
    g[start.id] = 0;
    came[start.id] = -1;
    push(start.id, h(start));
    let found = false;
    while (heap.length) {
      const [f, cur] = pop();
      if (cur === goal.id) {
        found = true;
        break;
      }
      if (f - h(nodes[cur]) > g[cur] + 1e-3) continue; // stale heap entry
      for (const e of nodes[cur].edges) {
        const ng = g[cur] + e.cost;
        if (seen[e.to] !== gen || ng < g[e.to]) {
          seen[e.to] = gen;
          g[e.to] = ng;
          came[e.to] = cur;
          via[e.to] = e;
          push(e.to, ng + h(nodes[e.to]));
        }
      }
    }
    if (!found) return null;
    const path = [];
    for (let id = goal.id; id !== start.id; id = came[id]) {
      path.push({ node: nodes[id], type: via[id].type, edge: via[id] });
    }
    return path.reverse();
  }

  randomNode(filter = null) {
    for (let i = 0; i < 30; i++) {
      const n = this.nodes[Math.floor(Math.random() * this.nodes.length)];
      if (n.edges.length && (!filter || filter(n))) return n;
    }
    return this.nodes[0];
  }

  stats() {
    const types = {};
    let edges = 0;
    for (const n of this.nodes) {
      for (const e of n.edges) {
        types[e.type] = (types[e.type] ?? 0) + 1;
        edges++;
      }
    }
    return { nodes: this.nodes.length, edges, types, buildMs: Math.round(this.buildMs) };
  }
}
