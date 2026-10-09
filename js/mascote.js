// Ofi — o lobo de terno do OFI. Humores: 'feliz', 'calmo', 'preocupado', 'festa' (img/ofi-*.png)

export const MASCOT_NAME = 'Ofi';

export const mascot = (mood = 'feliz', size = 96) =>
  `<img class="mascote m-${mood}" src="img/ofi-${mood}.png" width="${size}" height="${size}" alt="" draggable="false">`;

/** Mascote + balão de fala */
export const say = (mood, html, size = 72) =>
  `<div class="say">${mascot(mood, size)}<div class="bubble">${html}</div></div>`;
