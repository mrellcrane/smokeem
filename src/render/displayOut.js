// For effect shaders that write display-ready colors (tuned by eye on the canvas, which shows
// them as they are): append to the fragment shader's main, after the color is written. On the
// canvas it's a round trip that changes nothing; drawn into a linear render target (the bloom
// frame, render/bloom.js) it turns the color linear, so it looks the same after the frame is
// encoded for the screen.
export const DISPLAY_OUT = /* glsl */ `
    gl_FragColor.rgb = linearToOutputTexel(sRGBTransferEOTF(vec4(max(gl_FragColor.rgb, vec3(0.0)), 1.0))).rgb;
`;

// For additive effects tuned the same way: added in linear light, a faint glow converted to linear
// all but vanishes, while the raw value reads a little stronger than on the canvas over dark
// backgrounds, so drawn into a linear target it's kept, just scaled down a touch. (The check is
// constant per program: linearToOutputTexel is the identity only into a linear target.)
export const DISPLAY_ADD = /* glsl */ `
    gl_FragColor.rgb *= linearToOutputTexel(vec4(0.5)).r < 0.6 ? 0.6 : 1.0;
`;
