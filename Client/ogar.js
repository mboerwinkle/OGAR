"use strict";
//CONFIGURE THESE CONSTANTS
//is this embedded in qualtrics?
const isQual = false;
var GalleryOpts = {
	"BaseWidth":800,
	"BaseHeight":450,
	"FullWidth":1600,
	"FullHeight":900,
	"FragShader":"gl/world.frag",
	"VertShader":"gl/world.vert",
	"ArtSolidColor":false,
	"ReceptorAddr":"wss://example.com:6411",
	"GalleryPathOverride":null,
	"GalleryDataRoot":"https://example.com/ogar/"
};

var QualtricsThis = null;
if(isQual) QualtricsThis = this;
function nextButtonInterface(enable){
	if(!isQual) return;
	if(enable){
		QualtricsThis.enableNextButton();
	}else{
		QualtricsThis.disableNextButton();
	}
}
nextButtonInterface(false);

const EPSILON = 0.005;

if(!isQual){
	const urlParams = new URLSearchParams(window.location.search);
	Object.keys(GalleryOpts).forEach(function(k){
		if(urlParams.has(k)){
			GalleryOpts[k] = urlParams.getAll(k)[0];
		}
	});
}

var mycanv = document.createElement("canvas");
mycanv.id = "glCanvas";
mycanv.width = GalleryOpts["BaseWidth"];
mycanv.height = GalleryOpts["BaseHeight"];

var QID = 'ANON';

if(isQual){
	var qid = this.questionId;
	var qdiv = document.getElementById(qid);
	console.log(qdiv);
	qdiv.prepend(mycanv);

	var temp = function(){return ('0000'+Math.floor(Math.random()*10000)).slice(-4);};
	QID = "Q_"+temp()+temp()+temp();
	Qualtrics.SurveyEngine.setEmbeddedData('Cust_UniqueID', QID);
	galleryname = Qualtrics.SurveyEngine.getEmbeddedData('Cust_GalleryType');
}else{
	var temp = function(){return ('0000'+Math.floor(Math.random()*10000)).slice(-4);};
	QID = "TEST_"+temp()+temp()+temp();
	document.body.appendChild(mycanv);
}
//https://stackoverflow.com/questions/7293778/switch-canvas-context
var glcanvclone = mycanv.cloneNode(false);
var ctx = mycanv.getContext('2d');
ctx.textAlign = "center";
ctx.textBaseline = "middle";
ctx.font = "40px sans-serif";
function drawLoading(msg){
	ctx.fillStyle = "#88A0C0";//slate grey background
	ctx.fillRect(0,0,mycanv.width,mycanv.height);
	ctx.fillStyle = "#000000";
	ctx.fillText(msg, mycanv.width/2, mycanv.height/2);
}
drawLoading("Loading...");
console.log("QID: ",QID);


var gallerydefpath = "gallery.json";
if(!(GalleryOpts.GalleryPathOverride === null)){
	gallerydefpath = GalleryOpts.GalleryPathOverride;
}

class mbErrorRecorder{
	constructor(){
		this.errors = [];
		this.ws = null;
	}
	e(msg){
		const now = Date.now();
		const t = Math.floor(now/1000);
		var err = {"type":"err","time":t,"err":msg};
		console.log(msg);
		if(this.ws != null){//if we are connected, then send it
			this.wssend(err);
		}else{//cache the error till we get a connection
			this.errors.push(err);
		}
	}
	evt(msg){
		const now = Date.now();
		const t = Math.floor(now/1000);
		const msgkey = {"GFS":1, "LFS":2, "GPL":3, "LPL":4};
		var code = -1;
		if(!(msg in msgkey)){
			e("Could not find event: "+msg);
			return;
		}else{
			code = msgkey[msg];
		}
		var evt = {"type":"evt","time":t,"evt":code};
		console.log(msg);
		if(this.ws != null){//if we are connected, then send it
			this.wssend(evt);
		}else{//cache the event till we get a connection
			this.errors.push(evt);
		}	
	}
	wsconnect(ws){
		this.ws = ws;
		if(ws == null) return;
		this.errors.forEach(e => {
			this.wssend(e);
		});
		this.errors = [];
	}
	wssend(jmsg){
		//console.log("Sending "+JSON.stringify(jmsg));
		this.ws.send(JSON.stringify(jmsg));
	}
	printall(){
		console.log("##ERRORS##");
		this.errors.forEach(e => {
			console.log(e.t+' : "'+e.m+'"');
		});
		console.log("##END##");
	}
}

var E = new mbErrorRecorder();

//A small class to handle required resources
class recursiveLoader{
	load(path, type, onload, absolute){
		var realpath;
		if(absolute){
			realpath = path;
		}else{
			realpath = this.rpath+path;
		}
		var me = this;
		function metaonload(data){
			me.leftToLoad--;
			if(onload != null) onload(path, data, me.leftToLoad, me.max);
			if(me.leftToLoad == 0){
				me.onallload();
			}else if(me.leftToLoad < 0){
				E.e("recursiveloader lefttoload < 0");
			}
		}
		if(type == 'JSON'){
			fetch(realpath)
				.then(response => response.json())
				.then(data => metaonload(data));
		}else if(type == 'IMG'){
			var i = new Image();//Tex is the special image which contains the colors for floor, ceiling, wall, etc.
			i.addEventListener("load", function(){metaonload(i)});
			i.crossOrigin = "";
			i.src = realpath;
		}else if(type == 'TEXT'){
			fetch(realpath)
				.then(response => response.text())
				.then(data => metaonload(data));
		}else if(type == 'WS'){
			console.log("Loading "+realpath);
			var ws = new WebSocket(realpath);
			ws.onopen = function(){metaonload(ws)};
			ws.onerror = function(){console.error("Failed to load WS: "+realpath); metaonload(null);}
		}
	}

	constructor(rpath){
		this.rpath = rpath;
		this.onallload = null;
		this.loadStack = [];
		this.leftToLoad = 0;
		this.started = false;
		this.max = 0;//used for loading status
	}

	addTarget(path, type, onload, absolute=false){
		this.max++;
		if(this.started){
			this.leftToLoad++;
			this.load(path, type, onload, absolute);
		}else{//otherwise add it to the left-to
			this.leftToLoad++;
			this.loadStack.push({"path":path, "type":type, "onload":onload, "absolute":absolute});
		}
	}

	start(){
		this.started = true;
		var me = this;
		this.loadStack.forEach(l => {
			me.load(l.path, l.type, l.onload, l.absolute);
		});
	}
}

function isPowerOfTwo(x) {//from khronos group
	return (x & (x - 1)) == 0;
}

function nextHighestPowerOfTwo(x) {//from khronos group
	--x;
	for (var i = 1; i < 32; i <<= 1) {
		x = x | x >> i;
	}
	return x + 1;
}
function cross(res, a, b){
	res[0]=a[1]*b[2]-a[2]*b[1];
	res[1]=a[2]*b[0]-a[0]*b[2];
	res[2]=a[0]*b[1]-a[1]*b[0];
}
function rotate(v, r){
	var s = Math.sin(r);
	var c = Math.cos(r);
	return [v[0]*c - v[1]*s, v[0]*s + v[1]*c];
}
function dot(a, b){
	var res = 0;
	for(var idx = a.length-1; idx >= 0; idx--){
		res += a[idx]*b[idx];
	}
	return res;
}
function reverse(v){
	return v.map(i => -i);
}
function norm(v){
	var len = 0.0;
	v.forEach(function (i) { len += i*i; });
	if(len == 0.0){
		return v;//Everything was zeros
	}
	len = Math.sqrt(len);
	return v.map(i => i/len);
}
function distance2(x1, y1, x2, y2){
	var x = x1-x2;
	var y = y1-y2;
	return Math.sqrt(x*x+y*y);
}
function magnitude2(x, y){
	return Math.sqrt(x*x+y*y);
}
class Mat4{
	constructor(arr=null){
		if(arr){
			this.arr = arr;
		}else{
			this.arr = [];
			this.setTo(Mat4.idenMat); //default to identity matrix
		}
	}
	setTo(other){
		for(var i = 0; i < 16; i++){
			this.arr[i] = other.arr[i];
		}
	}
	mult2(mat1, mat2){
		var res = this.arr;
		var m1 = mat1.arr;
		var m2 = mat2.arr;
		for(var x = 0; x < 4; x++){
			for(var y = 0; y < 4; y++){
				var v = 0.0;
				for(var i = 0; i < 4; i++){
					v += m1[y+4*i]*m2[i+4*x];
				}
				res[y+4*x] = v;
			}
		}
	}
	mult(other){
		for(var x = 0; x < 4; x++){
			for(var y = 0; y < 4; y++){
				var v = 0;
				for(var i = 0; i < 4; i++){
					v += this.arr[y+4*i]*other.arr[i+4*x];
				}
				Mat4.tempMat.arr[y+4*x] = v;
			}
		}
		this.setTo(Mat4.tempMat);
	}
	trans(x, y, z){
		var r = this.arr;
		r[12] += x;
		r[13] += y;
		r[14] += z;
	}
	//https://www.khronos.org/registry/OpenGL-Refpages/gl2.1/xhtml/gluPerspective.xml
	gluPerspective(fovy, aspect, zNear, zFar){
		var f = 1.0/Math.tan(fovy/2.0);
		var m = this.arr;
		m[0] = f/aspect;
		m[1] = 0;m[2] = 0;m[3] = 0;m[4] = 0;
		m[5] = f;
		m[6] = 0;m[7] = 0;m[8] = 0;m[9] = 0;
		m[10] = (zFar+zNear)/(zNear-zFar);
		m[11] = -1;
		m[12] = 0;m[13] = 0;
		m[14] = (2.0*zFar*zNear)/(zNear-zFar);
		m[15] = 0;
	}
	//modified from https://www.khronos.org/registry/OpenGL-Refpages/gl2.1/xhtml/gluLookAt.xml
	glhLookAtf2(center3D, upVector3D){
		var side = [0,0,0];
		var up = [0,0,0];
		// --------------------
		// Side = forward x up
		cross(side, center3D, upVector3D);
		norm(side);
		// Recompute up as: up = side x forward
		cross(up, side, center3D);
		// --------------------
		this.arr[0] = side[0];
		this.arr[4] = side[1];
		this.arr[8] = side[2];
		// --------------------
		this.arr[1] = up[0];
		this.arr[5] = up[1];
		this.arr[9] = up[2];
		// --------------------
		this.arr[2] = -center3D[0];
		this.arr[6] = -center3D[1];
		this.arr[10] = -center3D[2];
		// --------------------
		this.arr[3] = this.arr[7] = this.arr[11] = this.arr[12] = this.arr[13] = this.arr[14] = 0.0;
		this.arr[15] = 1.0;
	}
	static zRot(r){
		var s = Math.sin(r);
		var c = Math.cos(r);
		Mat4.zRotMat.arr[0] = c;
		Mat4.zRotMat.arr[1] = s;
		Mat4.zRotMat.arr[4] = -s;
		Mat4.zRotMat.arr[5] = c;
		return Mat4.zRotMat;
	}
	static translate(x, y, z){
		Mat4.transMat.arr[12] = x;
		Mat4.transMat.arr[13] = y;
		Mat4.transMat.arr[14] = z;
		return Mat4.transMat;
	}
}
Mat4.idenMat = new Mat4([1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0]);
Mat4.tempMat = new Mat4();
Mat4.zRotMat = new Mat4();
Mat4.transMat = new Mat4();

Mat4.lookatMat2 = new Mat4();
Mat4.lookatResultMat = new Mat4();

class Mat3{
	constructor(arr=null){
		if(arr){
			this.arr = arr;
		}else{
			this.arr = [];
			this.setTo(Mat3.idenMat); //default to identity matrix
		}
	}
	setTo(other){
		for(var i = 0; i < 9; i++){
			this.arr[i] = other.arr[i];
		}
	}
	mult2(mat1, mat2){
		var res = this.arr;
		var m1 = mat1.arr;
		var m2 = mat2.arr;
		for(var x = 0; x < 3; x++){
			for(var y = 0; y < 3; y++){
				var v = 0.0;
				for(var i = 0; i < 3; i++){
					v += m1[y+3*i]*m2[i+3*x];
				}
				res[y+3*x] = v;
			}
		}
	}
	mult(other){
		for(var x = 0; x < 3; x++){
			for(var y = 0; y < 3; y++){
				var v = 0;
				for(var i = 0; i < 3; i++){
					v += this.arr[y+3*i]*other.arr[i+3*x];
				}
				Mat4.tempMat.arr[y+3*x] = v;
			}
		}
		this.setTo(Mat3.tempMat);
	}
	trans(x, y){
		var r = this.arr;
		r[6] += x;
		r[7] += y;
	}
	multvec(x, y){
		var v = [x,y,1];
		var r = [0,0];
		var m = this.arr;
		for(var x = 0; x < 2; x++){//Only 2 because we don't care about the last thing.
			var val = 0;
			for(var y = 0; y < 3; y++){
				val += m[x+3*y]*v[y];
			}
			r[x] = val;
		}
		return r;
	}
	static rot(r){
		var s = Math.sin(r);
		var c = Math.cos(r);
		Mat3.rotMat.arr[0] = c;
		Mat3.rotMat.arr[1] = s;
		Mat3.rotMat.arr[3] = -s;
		Mat3.rotMat.arr[4] = c;
		return Mat3.rotMat;
	}
	static translate(x, y){
		Mat3.transMat.arr[6] = x;
		Mat3.transMat.arr[7] = y;
		return Mat3.transMat;
	}
}
Mat3.idenMat = new Mat3([1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0]);
Mat3.tempMat = new Mat3();
Mat3.rotMat = new Mat3();
Mat3.transMat = new Mat3();

class Keyboard{
	constructor(){
		this.k = {"up":false, "down":false, "left":false, "right":false, "lt":false, "gt":false, "i":false, "k":false};
	}
	getMovementVector(viewAngle){
		var v = [0, 0];
		if(this.k["up"]) v[0]+=1.0;
		if(this.k["down"]) v[0]-=1.0;
		if(this.k["right"]) v[1]-=1.0;
		if(this.k["left"]) v[1]+=1.0;
		return norm(rotate(v, viewAngle));
	}
}
class Gallery{//FIXME art tex dims should be in by 0.5, not 1
	constructor(myCanvas, j, images, ws, qid){
		if(ws != null){
			var msg = JSON.stringify({"type":"reg", "qid":qid});
			ws.send(msg);
		}
		E.e("Test Error");
		E.wsconnect(ws);
		this.ws = ws;
		this.j = j;
		this.images = images;
		this.debugmode = false;
		//frustum z planes
		this.zplanes = new Float32Array([0.05, 40]);
		//this.zoffsetscale = 1.0/(this.zplanes[1]-this.zplanes[0]);
		//lens matrix
		this.cam_lens = new Mat4();
		this.cam_lens.gluPerspective(1.2, myCanvas.width/myCanvas.height, this.zplanes[0], this.zplanes[1]);//vfov was 1.22
		console.log(""+this.cam_lens.arr);
		//translation
		this.cam_trs = new Mat4();
		//cam pointing direction
		this.cam_rot = new Mat4();
		this.col_refframe = new Mat3();
		this.col_rotationMat = new Mat3();
		this.redraw = true;
		this.bounds = [0,0,0,0];
		this.wallH = j["wallHeight"];
		var wallH = this.wallH;
		this.points = this.convert2triangles(j["walls"]);
		this.texCoord = [];
		this.description = "";
		this.getArtDefinitions(j["art"]);
		this.myCanvas = myCanvas;
		var gl = myCanvas.getContext("webgl");
		if(gl == null){
			E.e("Browser incompatible with WebGL.");
			return;
		}
		this.gl = gl;
		gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);//FIXME this line shouldnt be copied anywhere
		gl.enable(gl.DEPTH_TEST);
		gl.enable(gl.CULL_FACE);
		gl.clearColor(0,0.5,0.5,1);
		this.loadTex(images);
		for(var t = 0; t < this.points.length/3; t++){
			this.texCoord = this.texCoord.concat([this.texMaxes[0]/6,this.texMaxes[1]*0.5]);
		} //set wall texture coordinates to all the same thing. (pix 0,0)
		{ //Create floor and ceiling
			var b = this.bounds;
			this.points = this.points.concat(b[0], b[1], 0, b[2], b[1], 0, b[0], b[3], 0, b[0], b[3], 0, b[2], b[1], 0, b[2], b[3], 0);
			this.points = this.points.concat(b[0], b[1], wallH, b[0], b[3], wallH, b[2], b[1], wallH, b[2], b[1], wallH, b[0], b[3], wallH, b[2], b[3], wallH);
			for(var l = 0; l <= 1; l++){
				for(var v = 0; v < 6; v++){
					this.texCoord = this.texCoord.concat([this.texMaxes[0]*(0.5+(l/3)),this.texMaxes[1]*0.5] ); //texcoord (middle pixel or right pixel)
				}
			}
		}
		this.getArtTriangles(j["artPlacement"]); //add the triangles for the art. This function also adds the arts texture coordinates
		this.normals = this.calculateNormals(this.points);
		Object.values(this.artDef).forEach( d => {
			d.normals = this.calculateNormals(d.points);
			
			//here
		});
		this.triCount = this.points.length/9;
		this.framerate = 60;
		this.invframerate = 1.0/this.framerate;
		this.pl = [j["patron"]["start"][0], j["patron"]["start"][1], j["patron"]["height"]];
		this.pVel = [0,0];
		this.pv = j["patron"]["dir"];//0 radians (rotation view angle)
		this.pvVert = 0.0;//straight forward (up/down view angle)
		var me = this;//for lambdas

		function mousemovefunc(e){
			me.pv -= e.movementX/500;
			me.pvVert -= e.movementY/500;
			me.redraw = true;
		}
		function keyupfunc(e){
			me.keyboard(event.keyCode, false);
		}
		function keydownfunc(e){
			me.keyboard(event.keyCode, true);
		}
		function fschange(){
			if(document.fullscreenElement == myCanvas){
				E.evt("GFS");
				myCanvas.width = GalleryOpts["FullWidth"];
				myCanvas.height = GalleryOpts["FullHeight"];
				myCanvas.requestPointerLock();
			}else{
				E.evt("LFS");
				myCanvas.width = GalleryOpts["BaseWidth"];
				myCanvas.height = GalleryOpts["BaseHeight"];
				document.exitPointerLock();
			}
			me.cam_lens.gluPerspective(1.2, myCanvas.width/myCanvas.height, me.zplanes[0], me.zplanes[1]);//vfov was 1.22
			gl.uniformMatrix4fv(me.u_cam_lens, false, me.cam_lens.arr);
			gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
			me.redraw = true;
		}
		document.addEventListener('fullscreenchange', fschange);
		document.addEventListener('webkitfullscreenchange', fschange);
		document.addEventListener('pointerlockchange', function(){
			if(document.pointerLockElement == myCanvas){
				E.evt("GPL");
				document.addEventListener('mousemove', mousemovefunc, false);
				document.addEventListener("keydown", keydownfunc);
				document.addEventListener("keyup", keyupfunc);
			}else{
				E.evt("LPL");
				document.removeEventListener('mousemove', mousemovefunc, false);
				document.removeEventListener("keydown", keydownfunc);
				document.removeEventListener("keyup", keyupfunc);
			}
		});
		myCanvas.onclick = function(){
			nextButtonInterface(true);
			if(myCanvas.requestFullscreen){
				myCanvas.requestFullscreen();
			}else if(myCanvas.webkitRequestFullscreen){
				myCanvas.webkitRequestFullscreen();
			}else{
				E.e("No Fullscreen Method");
			}
		};
		this.myKeyboard = new Keyboard();

		var program;
		program = this.createProgram(vertShader, fragShader);
		this.program = program;
		gl.linkProgram(program);
		if(!gl.getProgramParameter(program, gl.LINK_STATUS)){
			E.e("Program link error: "+gl.getProgramInfoLog(program));
		}
		gl.useProgram(program);

		this.addData();
		
		this.u_cam_rot = gl.getUniformLocation(program, "u_cam_rot");
		this.u_cam_trs = gl.getUniformLocation(program, "u_cam_trs");
		this.u_cam_lens = gl.getUniformLocation(program, "u_cam_lens");
		this.u_zoffset = gl.getUniformLocation(program, "u_zoffset");

		gl.uniformMatrix4fv(this.u_cam_lens, false, this.cam_lens.arr);
		this.perfcount_draw = 0;
		this.perftime_draw = 0;
		this.perfcount_iter = 0;
		this.perftime_iter = 0;
		window.requestAnimationFrame(function(timestamp){me.draw()});
		var intervals = [];
		intervals.push(setInterval(function(){me.gameIterate();}, 1000*this.invframerate));//Make the game progress
		intervals.push(setInterval(function(){me.sendPos();}, 1000/5));
		intervals.push(setInterval(function(){me.updatePerf();}, 1000));
		if(isQual) cust_intervals = intervals;
	}
	updatePerf(){
		const t = Math.floor(Date.now()/1000);
		var summary = {"type":"perf","t":t,"d":this.perfcount_draw,"dt":(this.perftime_draw/1000).toFixed(2),"i":this.perfcount_iter,"it":(this.perftime_iter/1000).toFixed(2)};
		this.perfcount_draw = 0;
		this.perftime_draw = 0;
		this.perfcount_iter = 0;
		this.perftime_iter = 0;
		if(this.ws != null){
			this.ws.send(JSON.stringify(summary));
		}else{
			console.log(summary);
		}
	}
	sendPos(){
		const now = Date.now();
		const t = Math.floor(now/1000);
		const m = now%1000;
		var stat = {"type":"pos", "time":t, "milli":m, "x": this.pl[0], "y": this.pl[1], "yaw": this.pv, "pitch": this.pvVert};
		if(this.ws != null){
			this.ws.send(JSON.stringify(stat));
		}
		if(this.coordPrintDom != null){
			this.coordPrintDom.value = stat["x"]+" "+stat["y"]+" "+stat["pitch"]+" "+stat["yaw"];
		}
	}
	getArtDefinitions(art){ //This takes the 'art' element
		var keys = Object.keys(art);
		this.artDef = {}; //In the form of "monalisa":{"tex":[0.0, 0.0, 0.05, (*9 because of [t1, t2, bias] for each corner)], "dim":[x, y]}. tex is texture coordinates
		var me = this;
	//	var bias = 0.05; //5 cm scaled
		keys.forEach(function (k){
			var a = art[k];
	//		var t1 = [0.0, 1.0, bias];
	//		var t2 = [1.0, 1.0, bias];
	//		var t3 = [0.0, 0.0, bias];
	//		var t4 = [1.0, 0.0, bias];
			var t1 = [0.0, 1.0];//FIXME why does this exist??? it is handled in getArtTriangles
			var t2 = [1.0, 1.0];
			var t3 = [0.0, 0.0];
			var t4 = [1.0, 0.0];
			var tex = [].concat(t1,t2,t3,t2,t3,t4);
			me.artDef[k] = {"tex":tex, "size":a["size"], "text":a["text"], "texture":a["texture"], "points":[], "texCoord":[]};
		});
	}
	getArtTriangles(artInst){//This takes the 'artPlacement' element
		var me = this;
		artInst.forEach(function (a){
			var aDef = me.artDef[a["art"]];
			if(-1 == Object.keys(a).findIndex(i => (i == "size"))){
				a["size"] = aDef["size"]; //Put in the default size from the definition if not explicit
			}
			a["size"] = a["size"].map(function(item){return item;});//FIXME
			if(a.hasOwnProperty("scale")){
				a["size"] = a["size"].map(x => x*a["scale"]);
			}
			var c = a["loc"].map(function(i){return i;});//FIXME
			var relLeft = [0, -a["size"][0]/2];
			relLeft = rotate(relLeft, a["dir"]/180*Math.PI);
			var left = [c[0]+relLeft[0], c[1]+relLeft[1]];
			var right = [c[0]-relLeft[0], c[1]-relLeft[1]];
			var bottom = a["height"] - a["size"][1]/2;
			var top = a["height"] + a["size"][1]/2;

			var p1 = [left[0], left[1], bottom];//bottom left
			var p2 = [right[0], right[1], bottom];//bottom right
			var p3 = [left[0], left[1], top];//top left
			var p4 = [right[0], right[1], top];//top right


			//FIXME this exists to offset art 1cm from the wall
			var offset = rotate([0.01,0], a['dir']/180*Math.PI);
			p1[0] += offset[0];
			p1[1] += offset[1];
			p2[0] += offset[0];
			p2[1] += offset[1];
			p3[0] += offset[0];
			p3[1] += offset[1];
			p4[0] += offset[0];
			p4[1] += offset[1];

			aDef.points = aDef.points.concat(p1,p2,p3,p4,p3,p2);
			var m1 = aDef.texMaxes[0];
			var m2 = aDef.texMaxes[1];
			var t1 = [0.0, m2];
			var t2 = [m1, m2];
			var t3 = [0.0, 0.0];
			var t4 = [m1, 0.0];
			aDef.texCoord = aDef.texCoord.concat(t1,t2,t3,t4,t3,t2);//FIXME
//			aDef.texCoord = aDef.texCoord.concat(t);
		});
	}
	loadTex(images){
		var gl = this.gl;
		this.texMaxes = [1,1];
		var colorOverride = null;
		if(GalleryOpts["ArtSolidColor"]){
			colorOverride = "#000000";
		}
		this.gltexture = this.createTextureFromImage(images["__tex"], this.texMaxes, colorOverride);
		gl.bindTexture(gl.TEXTURE_2D, this.gltexture);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR); //This is for things like windows with very small textures.
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR); //This is for paintings where we only see a small portion of their real resolution
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

		var me = this;
		Object.keys(this.artDef).forEach( function(k, kidx){
			var d = me.artDef[k];
			d.texMaxes = [1,1]
			colorOverride = null;
			if(GalleryOpts["ArtSolidColor"]){
				var colorNum = 5*(kidx+1);
				if(colorNum > 255){
					console.log("Insufficient color space for all artwork!");
					return;
				}
				var hexStr = colorNum.toString(16);
				hexStr = (hexStr.length == 1) ? "0" + hexStr : hexStr;
				colorOverride = "#ff00"+hexStr;
			}
			d.gltexture = me.createTextureFromImage(images[k], d.texMaxes, colorOverride);
			gl.bindTexture(gl.TEXTURE_2D, d.gltexture);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR); //This is for things like windows with very small textures.
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR); //This is for paintings where we only see a small portion of their real resolution
			//gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); //This is temporary pending powerof2 fix
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
		});
	}
	convert2triangles (seg){
		var s = 1.0;//FIXME
		var t = [];
		for(var cIdx = 0; cIdx < seg.length; cIdx++){//idx of continuous chains
			var i = seg[cIdx];
			for(var idx = 0; idx+1 < i.length / 2; idx++){
				var xs = [s*i[idx*2], s*i[idx*2+2]];
				var ys = [s*i[idx*2+1], s*i[idx*2+3]];
				var minx = Math.min(xs[0], xs[1]);
				var miny = Math.min(ys[0], ys[1]);
				var maxx = Math.max(xs[0], xs[1]);
				var maxy = Math.max(ys[0], ys[1])
	
				if(this.bounds[0] > minx){
					this.bounds[0] = minx;
				}
				if(this.bounds[1] > miny){
					this.bounds[1] = miny;
				}
				if(this.bounds[2] < maxx){
					this.bounds[2] = maxx;
				}
				if(this.bounds[3] < maxy){
					this.bounds[3] = maxy;
				}
				var pt1 = [s*i[idx * 2], s*i[(idx * 2) + 1], 0];
				var pt2 = [s*i[(idx * 2) + 2], s*i[(idx * 2) + 3], 0];
				var pt3 = [s*i[idx * 2], s*i[(idx * 2) + 1], this.wallH];
				t = t.concat(pt1.concat(pt2.concat(pt3)));
			
				pt1 = [s*i[(idx * 2) + 2], s*i[(idx * 2) + 3], this.wallH];
				t = t.concat(pt3.concat(pt2.concat(pt1)));
			}
		}
		console.log("Bounds: "+this.bounds);
		return t;
	}
	calculateNormals(pts){
		var normals = [];
		for(var i = 0; i < pts.length; i+=9){
			var a = [0, 0, 0];
			var b = [0, 0, 0];
			for(var d = 0; d < 3; d++){
				a[d] = pts[i+d] - pts[i+d+3];
				b[d] = pts[i+d+3] - pts[i+d+6];
			}
			var n1 = (a[1]*b[2] - a[2]*b[1]); 
			var n2 = (a[2]*b[0] - a[0]*b[2]); 
			var n3 = (a[0]*b[1] - a[1]*b[0]);
			//console.log("normal: "+n1+" "+n2+" "+n3);
			for(var redo = 0; redo < 3; redo++){//FIXME we should definitely figure out how to pass by reference instead of this bullshit
				normals.push(n1);
				normals.push(n2);
				normals.push(n3);
			}
		}
		return normals;
	}
	draw(){
		this.perfcount_draw += 1;
		var drawstart = performance.now();
		const me = this;
		/*if(!this.redraw){
			window.requestAnimationFrame(function(timestamp){me.draw()});
			return;
		}
		this.redraw = false;*/ //FIXME remove redraw tag

		var gl = this.gl;//FIXME combined setToMult should be faster. FIXME make benchmark
		//this.cam_rot.setTo(Mat4.idenMat);
		const cospv = Math.cos(this.pv);
		const cospvvert = Math.cos(this.pvVert);
		const sinpv = Math.sin(this.pv);
		const sinpvvert = Math.sin(this.pvVert);
		this.cam_rot.glhLookAtf2([cospv*cospvvert, sinpv*cospvvert, sinpvvert], [-cospv*sinpvvert, -sinpv*sinpvvert, cospvvert]);
//		this.cam_rot.glhLookAtf2([cospv*cospvvert, sinpv*cospvvert, sinpvvert], [0,0,1]);
		this.cam_trs.setTo(Mat4.translate(-this.pl[0], -this.pl[1], -this.pl[2]));
		gl.uniformMatrix4fv(this.u_cam_rot, false, this.cam_rot.arr);
		gl.uniformMatrix4fv(this.u_cam_trs, false, this.cam_trs.arr);
		gl.uniform1f(this.u_zoffset, 0.0);
		this.gl.clear(this.gl.DEPTH_BUFFER_BIT | this.gl.COLOR_BUFFER_BIT);

		gl.bindTexture(gl.TEXTURE_2D, this.gltexture);
		gl.bindBuffer(gl.ARRAY_BUFFER, this.vbuffer);
		gl.vertexAttribPointer(this.a_position, 3, gl.FLOAT, false, 0, 0);//0 stride means please calculate for me based on numComponents and type
		gl.vertexAttribPointer(this.a_normal, 3, gl.FLOAT, true, 0, this.points.length*4);
		gl.bindBuffer(gl.ARRAY_BUFFER, this.tbuffer);
		gl.vertexAttribPointer(this.a_texcoord, 2, gl.FLOAT, false, 0, 0);
		gl.drawArrays(gl.TRIANGLES, 0, this.points.length/3);

		gl.uniform1f(this.u_zoffset, 0.0);//*this.zoffsetscale);//5cm offset for artwork
		Object.values(this.artDef).forEach(d => {
			gl.bindTexture(gl.TEXTURE_2D, d.gltexture);
			gl.bindBuffer(gl.ARRAY_BUFFER, d.vbuffer);
			gl.vertexAttribPointer(me.a_position, 3, gl.FLOAT, false, 0, 0);//0 stride means please calculate for me based on numComponents and type
			gl.vertexAttribPointer(me.a_normal, 3, gl.FLOAT, true, 0, d.points.length*4);
			gl.bindBuffer(gl.ARRAY_BUFFER, d.tbuffer);
			gl.vertexAttribPointer(me.a_texcoord, 2, gl.FLOAT, false, 0, 0);
			gl.drawArrays(gl.TRIANGLES, 0, d.points.length/3);
		});
		window.requestAnimationFrame(function(timestamp){me.draw()});
		this.perftime_draw += performance.now()-drawstart;
	}
	collide(start, end, recurse = 0){
		if(recurse > 5){
			console.log("too much recursion");
			return start;//limit recursion
		}

		var wgs = this.j["walls"];
		//movement segment
		var mseg = [start[0], start[1], end[0], end[1]];
		//movement vector;
		var mvec = [end[0]-start[0], end[1]-start[1]];
		//normalized movement vector
		var nmvec = norm(mvec);
		//the distance of our movement
		var linelen = magnitude2(mvec[0], mvec[1]);
		const rad = 0.25;//25 cm is radius of circle I am in.
		var refframe = this.col_refframe;//new Mat3();//FIXME this shouldn't be created each frame
		var rotationMat = this.col_rotationMat;//new Mat3();
		rotationMat.setTo(Mat3.rot(-Math.atan2(nmvec[1], nmvec[0])));
		var closestCollision = Infinity;
		var collider = null;
		wgs.forEach(wg => {
			for(var widx = 0; widx < wg.length/2-1; widx++){
				var w = [wg[widx*2+0], wg[widx*2+1], wg[widx*2+2], wg[widx*2+3]];
				var wallvec = norm([w[2]-w[0], w[3]-w[1]]);
				var orthvec = rotate(wallvec, Math.PI/2);
				if(dot(orthvec, nmvec) < 0){//flip the vector to align with the movement vector
					orthvec = reverse(orthvec);
				}
				var rimOffset = [orthvec[0]*rad, orthvec[1]*rad];//This is the offset of the point on the circle which might collide with the line
				refframe.mult2(rotationMat, Mat3.translate(-(start[0]+rimOffset[0]),-(start[1]+rimOffset[1])));
				var rw1 = refframe.multvec(w[0],w[1]);//rotated wall points
				var rw2 = refframe.multvec(w[2],w[3]);
				/*if(rw1[1]*rw2[1] > 0) continue;//If it is >0, they must be both positive or both negative. (and so on the wrong side of the line)*/
				var rwv = [rw2[0]-rw1[0],rw2[1]-rw1[1]];
				var rwvmult = -rw1[1]/rwv[1];
				if(rwvmult > 1+EPSILON || rwvmult < 0-EPSILON) continue;//either this check or the one above should exist, but not both.
				var cdist = rw1[0]+rwv[0]*rwvmult;//x intercept
				if(cdist < 0-EPSILON || cdist > linelen+EPSILON) continue;//This checks if it collides with the movement ray.
				if(cdist < closestCollision){
					closestCollision = cdist;
					collider = [wallvec[0], wallvec[1]];
				}
			}
			for(var wpidx = 0; wpidx < wg.length/2; wpidx++){
				var wp = [wg[wpidx*2], wg[wpidx*2+1]];
				refframe.mult2(rotationMat, Mat3.translate(-start[0],-start[1]));
				var rw = refframe.multvec(wp[0], wp[1]);//rotated point
				if(rw[0] < 0 || rw[0] > linelen+rad || rw[1] > rad || rw[1] < -rad) continue;//this point is not in the possible bounding box
				/*if(rw[0] < linelen|| distance2(rw[0], rw[1], linelen, 0) < rad){//We are inside the main box or the nose cone, so we know we definitely collide*/
					/*var cdist = rw[0] - rad* Math.sin(Math.acos(Math.abs(rw[1]/rad)));//FIXME*/
					var cdist = rw[0] - rad*Math.sqrt(1-Math.pow(rw[1]/rad,2));
					if(cdist > linelen) continue;//This should be commented if we uncomment the surrounding if statement
					if(cdist < closestCollision){
						closestCollision = cdist;
						collider = rotate(norm([wp[0]-(start[0]+nmvec[0]*cdist), wp[1]-(start[1]+nmvec[1]*cdist)]), Math.PI/2);
					}
				//}
			}
		});
		if(collider != null){
			closestCollision -= EPSILON;
			var newstart = [start[0]+nmvec[0]*closestCollision, start[1]+nmvec[1]*closestCollision, end[2]];
			var remainingmove = linelen-closestCollision;//How much longer we can move after this collision
			if(remainingmove < EPSILON){
				return newstart;
			}
			var tanvecmag = dot(collider, nmvec);
			
			var newend = [newstart[0]+tanvecmag*collider[0]*remainingmove, newstart[1]+tanvecmag*collider[1]*remainingmove, end[2]];
			
//			return newend;//This disables recursive handling of the collision, and instead just returns after the first step
			return this.collide(newstart, newend, recurse+1);
		}
		return end;
	}
	gameIterate(){
		this.perfcount_iter += 1;
		var iterstart = performance.now();
		var moveMult = 1.8;
		var rotMult = 0.7;
		var m = this.myKeyboard.getMovementVector(this.pv);
		var accelMult = 5.0; // inverse of time in seconds to get from still to full speed.
		if(m[0] != 0.0 || m[1] != 0.0){
			var deltaVel = [m[0]-this.pVel[0], m[1]-this.pVel[1]];
			var deltaMag = magnitude2(deltaVel[0],deltaVel[1]); //This is the size of the difference between our current velocity and our desired velocity
			if(deltaMag > accelMult*this.invframerate){//If we want to do more acceleration than we can, then cap it
				deltaVel = norm(deltaVel).map(x => x*accelMult*this.invframerate);
				this.pVel[0] += deltaVel[0];
				this.pVel[1] += deltaVel[1];
			}else{ //Otherwise, this is within our capabilities, so we set our speed directly to target
				this.pVel[0] = m[0];
				this.pVel[1] = m[1];
			}
		}else{//if we aren't actively moving, stop dead
			this.pVel = [0,0];
		}
		if(this.pVel[0] != 0 || this.pVel[1] != 0){
			this.redraw = true;
			var dest = [this.pl[0]+moveMult*this.pVel[0]*this.invframerate, this.pl[1]+moveMult*this.pVel[1]*this.invframerate, this.pl[2]];//movement initial destination for this frame
			this.pl = this.collide(this.pl, dest);
		}
		if(this.myKeyboard.k["lt"]){
			this.redraw = true;
			this.pv += rotMult*0.5*Math.PI*this.invframerate;
		}
		if(this.myKeyboard.k["gt"]){
			this.redraw = true;
			this.pv -= rotMult*0.5*Math.PI*this.invframerate;
		}
		if(this.myKeyboard.k["i"]){
			this.redraw = true;
			this.pvVert += 0.05;
		}
		if(this.myKeyboard.k["k"]){
			this.redraw = true;
			this.pvVert -= 0.05;
		}
		while(this.pv < 0){
			this.pv += 2*Math.PI;
		}
		while(this.pv > 2*Math.PI){
			this.pv -= 2*Math.PI;
		}
		while(this.pvVert > Math.PI/2){
			this.pvVert = Math.PI/2;
		}
		while(this.pvVert < -Math.PI/2){
			this.pvVert = -Math.PI/2;
		}
		this.perftime_iter += performance.now()-iterstart;
	}
	keyboard(code, down){
		if(code == 37 || code == 65){
			this.myKeyboard.k["left"] = down;
		}else if(code == 38 || code == 87){
			this.myKeyboard.k["up"] = down;
		}else if(code == 39 || code == 68){
			this.myKeyboard.k["right"] = down;
		}else if(code == 40 || code == 83){
			this.myKeyboard.k["down"] = down;
		}else if(code == 188 || code == 74){
			this.myKeyboard.k["lt"] = down;
		}else if(code == 190 || code == 76){
			this.myKeyboard.k["gt"] = down;
		}else if(code == 73){
			this.myKeyboard.k["i"] = down;
		}else if(code == 75){
			this.myKeyboard.k["k"] = down;
		}else if(code == 192){
			if(down){
				this.debugmode = !this.debugmode;
				console.log("Debug mode: "+this.debugmode);
				this.redraw = true;
			}
		}
	}
	createProgram(vertex, fragment){
		const gl = this.gl;
		const ver = gl.createShader(gl.VERTEX_SHADER);
		const frag = gl.createShader(gl.FRAGMENT_SHADER);
		gl.shaderSource(ver, vertex);
		gl.shaderSource(frag, fragment);
		gl.compileShader(ver);
		gl.compileShader(frag);
		if(!gl.getShaderParameter(ver, gl.COMPILE_STATUS)){
			E.e("Failed to compile vertex shader: "+gl.getShaderInfoLog(ver));
		}
		if(!gl.getShaderParameter(frag, gl.COMPILE_STATUS)){
			E.e("Failed to compile fragment shader: "+gl.getShaderInfoLog(frag));
		}
		var program = gl.createProgram();
		gl.attachShader(program, ver);
		gl.attachShader(program, frag);
		return program;
	}
	createTextureFromImage(image, maxes, colorOverride = null){//From khronos group
		const gl = this.gl;
		const texture = gl.createTexture();
		gl.bindTexture(gl.TEXTURE_2D, texture);
		maxes[0] = 1;//Maxes is used to know where the actual new corner of the texture is
		maxes[1] = 1;
		if (!isPowerOfTwo(image.width) || !isPowerOfTwo(image.height)) {
			// Scale up the texture to the next highest power of two dimensions.
			var canvas = document.createElement("canvas");
			canvas.width = nextHighestPowerOfTwo(image.width);
			canvas.height = nextHighestPowerOfTwo(image.height);
			var ctx = canvas.getContext("2d");
			ctx.drawImage(image, 0, 0, image.width, image.height);
			if(colorOverride != null){
				ctx.fillStyle = colorOverride;
				ctx.fillRect(0, 0, canvas.width, canvas.height);
			}
			maxes[0] = image.width/canvas.width;
			maxes[1] = image.height/canvas.height;
			image = canvas;
		}
		gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
		gl.generateMipmap(gl.TEXTURE_2D);
		gl.bindTexture(gl.TEXTURE_2D, null);
		return texture;
	}
	addData(){
		const gl = this.gl;
		this.a_position = gl.getAttribLocation(this.program, 'a_position');//position array
		this.a_normal = gl.getAttribLocation(this.program, 'a_normal');//normal array
		this.a_texcoord = gl.getAttribLocation(this.program, 'a_texcoord');//texture coordinates
		gl.enableVertexAttribArray(this.a_position);
		gl.enableVertexAttribArray(this.a_normal);
		gl.enableVertexAttribArray(this.a_texcoord);
		var me = this;
		Object.keys(this.artDef).forEach(k => {
			var d = me.artDef[k];
			d.vbuffer = gl.createBuffer();
			gl.bindBuffer(gl.ARRAY_BUFFER, d.vbuffer);
			gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(d.points.concat(d.normals)), gl.STATIC_DRAW);
			
			d.tbuffer = gl.createBuffer();
			gl.bindBuffer(gl.ARRAY_BUFFER, d.tbuffer);
			gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(d.texCoord), gl.STATIC_DRAW);
		});

		this.vbuffer = gl.createBuffer();//Create and bind vertex/normal buffer
		gl.bindBuffer(gl.ARRAY_BUFFER, this.vbuffer);
		gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(this.points.concat(this.normals)), gl.STATIC_DRAW);

		this.tbuffer = gl.createBuffer();//Create and bind texcoord buffer
		gl.bindBuffer(gl.ARRAY_BUFFER, this.tbuffer);
		gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(this.texCoord), gl.STATIC_DRAW);
	}
}




var loader = new recursiveLoader(GalleryOpts["GalleryDataRoot"]);
var vertShader;
loader.addTarget(GalleryOpts["VertShader"], 'TEXT', function(path, data){vertShader = data;});
var fragShader;
loader.addTarget(GalleryOpts["FragShader"], 'TEXT', function(path, data){fragShader = data;});
var ws = null;//receptor server websocket
if(GalleryOpts["ReceptorAddr"] != "NONE"){
	loader.addTarget(GalleryOpts["ReceptorAddr"], 'WS', function(path, data){ws = data;}, true);
}
var images = {};
var gallerydata;

loader.addTarget(gallerydefpath, 'JSON', function(path, data){
	gallerydata = data;
	loader.addTarget(data["texture"], 'IMG', function(path, data){images["__tex"] = data});
	Object.keys(data["art"]).forEach(k => {
		loader.addTarget(data["art"][k]["texture"], 'IMG', function(path, data, remainingload, totalload){
			images[k] = data;
			drawLoading("Loading "+(totalload-remainingload)+"/"+totalload);
		});
	});
});
var gallery;
loader.onallload = function(){
	mycanv.parentNode.replaceChild(glcanvclone, mycanv);
	mycanv = glcanvclone;
	gallery = new Gallery(mycanv, gallerydata, images, ws, QID);
	if(isQual){
		OGARgallery = gallery;
	}
};
loader.start();
