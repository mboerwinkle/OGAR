# version 100
precision mediump float;
varying vec3 vNorm;
varying vec3 viewVec;
varying vec2 f_texcoord;//texture coordinates
uniform sampler2D u_texture;//the textures
void main(){
	vec3 baseColor = texture2D(u_texture, f_texcoord).xyz;
	baseColor = baseColor*(0.5 + 0.5*abs(dot(vNorm, normalize(viewVec))));
	gl_FragColor = vec4(baseColor, 1.0);
}
