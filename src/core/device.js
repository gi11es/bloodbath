// Device capabilities used to adapt controls, layout and render quality.
const params = new URLSearchParams(location.search);
export const isTouchDevice = params.get('touch') === '1' || (params.get('touch') !== '0' && (('ontouchstart' in window) || navigator.maxTouchPoints > 0) && matchMedia('(pointer: coarse)').matches);
// phones and small tablets: cap texture sizes and internal resolution
export const isMobile = isTouchDevice && Math.min(screen.width, screen.height) < 900;
export const maxTextureDim = isMobile ? 2048 : 8192;
