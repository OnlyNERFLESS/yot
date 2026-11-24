// The live-location marker, drawn as a small DOM overlay rather than a map
// layer, so it can be a real 3D object: it lies on the road plane (rotateX by
// the map's pitch, rotateZ by heading minus bearing) and, while navigating,
// is an extruded chevron whose stacked slices give it thickness when the map
// is tilted. Placed from map.project() on every render; transform only.
import type { Map as MlMap } from 'maplibre-gl';

export type PuckMode = 'dot' | 'nav';

const CHEVRON = 'M22 3 L41 47 L22 37 L3 47 Z';
const SLICES = 6; // extrusion depth, in 1.5px layers

function chevronSvg(kind: 'face' | 'side' | 'shadow'): string {
  if (kind === 'face') {
    return `<svg viewBox="0 0 44 50" width="44" height="50" aria-hidden="true">
      <defs><linearGradient id="puck-l" x1="0" x2="1"><stop offset="0.5" stop-color="#ffffff"/><stop offset="0.5" stop-color="#c8f6da"/></linearGradient></defs>
      <path d="${CHEVRON}" fill="url(#puck-l)" stroke="#058c42" stroke-width="2.2" stroke-linejoin="round"/>
      <path d="M22 9 L22 33" stroke="#058c42" stroke-width="1" opacity="0.35"/>
    </svg>`;
  }
  const fill = kind === 'side' ? '#04622f' : 'rgba(0,0,0,0.35)';
  return `<svg viewBox="0 0 44 50" width="44" height="50" aria-hidden="true"><path d="${CHEVRON}" fill="${fill}" stroke="${fill}" stroke-width="2.2" stroke-linejoin="round"/></svg>`;
}

export class Puck {
  private root = document.createElement('div');
  private ground = document.createElement('div');
  private dot = document.createElement('div');
  private at: [number, number] | null = null;
  private heading: number | null = null;
  private mode: PuckMode = 'dot';

  constructor(private map: MlMap) {
    this.root.className = 'puck';
    this.root.hidden = true;
    this.ground.className = 'puck-ground';
    this.ground.innerHTML = `
      <i class="puck-halo"></i><i class="puck-pulse"></i><i class="puck-cone"></i>
      <div class="puck-arrow">
        <div class="puck-slice shadow">${chevronSvg('shadow')}</div>
        ${Array.from({ length: SLICES }, (_, i) => `<div class="puck-slice" style="transform:translateZ(${(i + 1) * 1.5}px)">${chevronSvg('side')}</div>`).join('')}
        <div class="puck-slice" style="transform:translateZ(${(SLICES + 1) * 1.5}px)">${chevronSvg('face')}</div>
      </div>`;
    this.dot.className = 'puck-dot';
    this.root.append(this.ground, this.dot);
    map.getCanvasContainer().appendChild(this.root);
    map.on('render', this.place);
  }

  set(at: [number, number] | null, heading: number | null, mode: PuckMode) {
    this.at = at;
    this.heading = heading;
    if (mode !== this.mode) {
      this.mode = mode;
      this.root.dataset.mode = mode;
    }
    this.root.classList.toggle('has-heading', heading !== null);
    this.place();
  }

  remove() {
    this.map.off('render', this.place);
    this.root.remove();
  }

  private place = () => {
    if (!this.at) {
      this.root.hidden = true;
      return;
    }
    this.root.hidden = false;
    this.root.dataset.mode = this.mode;
    const p = this.map.project(this.at);
    const rot = (this.heading ?? 0) - this.map.getBearing();
    this.root.style.transform = `translate(${p.x}px, ${p.y}px)`;
    this.ground.style.transform = `rotateX(${this.map.getPitch()}deg) rotateZ(${rot}deg)`;
  };
}
