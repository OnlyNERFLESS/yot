// The selected-place marker: a pin that drops onto the chosen place with a
// small bounce and a ring that ripples out once, so a tap visibly lands
// somewhere. A DOM overlay (like the location puck) because a map symbol
// cannot animate; placed with map.project() on every render, transform only.
import type { Map as MlMap } from 'maplibre-gl';

const PIN = `<svg viewBox="0 0 32 42" width="32" height="42" aria-hidden="true">
  <path d="M16 1C7.7 1 1 7.6 1 15.8 1 27 16 41 16 41s15-14 15-25.2C31 7.6 24.3 1 16 1z" fill="#16db65" stroke="#04471c" stroke-width="2"/>
  <circle cx="16" cy="15.5" r="5.6" fill="#ffffff"/>
</svg>`;

export class SelPin {
  private root = document.createElement('div');
  private at: [number, number] | null = null;

  constructor(private map: MlMap) {
    this.root.className = 'selpin';
    this.root.hidden = true;
    this.root.innerHTML = `<i class="selpin-ring"></i><i class="selpin-shadow"></i><span class="selpin-pin">${PIN}</span>`;
    map.getCanvasContainer().appendChild(this.root);
    map.on('render', this.place);
  }

  /** Show at a place; a new place replays the drop. */
  show(at: [number, number]) {
    const same = this.at && this.at[0] === at[0] && this.at[1] === at[1];
    this.at = at;
    this.place();
    if (!same) {
      // Restart the drop: removing and re-adding the class retriggers it.
      this.root.classList.remove('drop');
      void this.root.offsetWidth;
      this.root.classList.add('drop');
    }
  }

  hide() {
    this.at = null;
    this.root.hidden = true;
  }

  remove() {
    this.map.off('render', this.place);
    this.root.remove();
  }

  private place = () => {
    if (!this.at) return;
    this.root.hidden = false;
    const p = this.map.project(this.at);
    this.root.style.transform = `translate(${p.x}px, ${p.y}px)`;
  };
}
