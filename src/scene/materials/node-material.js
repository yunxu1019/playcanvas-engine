import { programlib } from '../../graphics/program-lib/program-lib.js';
import { Shader } from '../../graphics/shader.js';

import { Material } from './material.js';

import {
    SHADER_FORWARD
    // SHADER_DEPTH, SHADER_FORWARD, SHADER_FORWARDHDR, SHADER_PICK, SHADER_SHADOW
} from '../constants.js';

import { Texture } from '../../graphics/texture.js';
import { Vec2 } from '../../math/vec2.js';
import { Vec3 } from '../../math/vec3.js';
import { Vec4 } from '../../math/vec4.js';

//global placeholder material
var _placeHolderNodeMat = null;

/**
 * @class
 * @name pc.NodeMaterial
 * @augments pc.Material
 * @classdesc A Node material is for rendering geometry with material properties set by a material node graph
 * @param {string} funcGlsl - shader function used by this material
 * @param {string} declGlsl - shader declarations used by the shader function
 */
var NodeMaterial = function (funcGlsl, declGlsl) {
    Material.call(this);

    // storage for asset references
    this._ioPortAssetReferences = [];
    this._glslAssetReferences = {};
    this._subGraphAssetReferences = [];

    this.graphData = {};

    this.graphData.ioPorts = []; // input, output or constant variables

    if (funcGlsl) {
        this.graphData.customFuncGlsl = funcGlsl;
        this.graphData.customDeclGlsl = declGlsl;
        this.genCustomFuncVars();
    } else {
        this.graphData.subGraphs = [];
        this.graphData.connections = [];
    }

    this.shaderVariants = [];

};

NodeMaterial.prototype = Object.create(Material.prototype);
NodeMaterial.prototype.constructor = NodeMaterial;

Object.assign(NodeMaterial.prototype, {
    /**
     * @function
     * @name pc.NodeMaterial#clone
     * @description Duplicates a Node material. All properties are duplicated except textures
     * where only the references are copied.
     * @returns {pc.NodeMaterial} A cloned Node material.
     */
    clone: function () {
        var clone = new NodeMaterial();

        Material.prototype._cloneInternal.call(this, clone);

        clone.graphData = {};

        clone.graphData.ioPorts = this.graphData.ioPorts.slice(0);
        clone.graphData.subGraphs = this.graphData.subGraphs.slice(0);
        clone.graphData.connections = this.graphData.connections.slice(0);

        clone.graphData.customDeclGlsl = this.graphData.customDeclGlsl;
        clone.graphData.customFuncGlsl = this.graphData.customFuncGlsl;

        clone.shaderVariants = this.shaderVariants.slice(0);

        return clone;
    },

    updateUniforms: function () {
        this.clearParameters();

        for (var n = 0; n < this.graphData.ioPorts.length; n++) {
            var ioPort = this.graphData.ioPorts[n];

            if (ioPort.name.startsWith('IN_') || (ioPort.name.startsWith('CONST_') && ioPort.type === 'sampler2D')) {
                var matId = '_' + this.id;

                switch (ioPort.type) {
                    case 'sampler2D':
                        this.setParameter(ioPort.name + matId, ioPort.valueTex);
                        break;
                    case 'float':
                        this.setParameter(ioPort.name + matId, ioPort.valueX);
                        break;
                    case 'vec2':
                        this.setParameter(ioPort.name + matId, [ioPort.valueX, ioPort.valueY]);
                        break;
                    case 'vec3':
                        this.setParameter(ioPort.name + matId, [ioPort.valueX, ioPort.valueY, ioPort.valueZ]);
                        break;
                    case 'vec4':
                        this.setParameter(ioPort.name + matId, [ioPort.valueX, ioPort.valueY, ioPort.valueZ, ioPort.valueW]);
                        break;
                    case 'samplerCube':
                    default:
                        // error
                        break;
                }
            }
        }

        if (this.dirtyShader || !this._scene) {
            this.shader = null;
            this.clearVariants();
        }
    },

    updateShader: function (device, scene, objDefs, staticLightList, pass, sortedLights) {
        if (this.hasValidGraphData()) {
            this.initShader(device);
            this.dirtyShader = false;
        }

        if (this.shaderVariants[pass]) {
            this.shader = this.shaderVariants[pass];
        } else {
            if (!this._placeHolderShader)
            {
                this._genPlaceholderNodeMat(device);
            }
            this.shader = this._placeHolderShader;
        }
    },

    _genPlaceholderNodeMat: function (device) {
        if (!_placeHolderNodeMat)
        {
            _placeHolderNodeMat = new NodeMaterial('void placeHolder(out vec3 vertOff, out vec4 fragOut){ vertOff=vec3(0); fragOut=vec4(0,0,1,1);}');
            _placeHolderNodeMat.initShader(device);
            _placeHolderNodeMat.updateUniforms();
        }
        this._placeHolderShader = _placeHolderNodeMat.shaderVariants[SHADER_FORWARD];
    },

    hasValidGraphData: function (graphRootTime) {
        var i;
        if (this.graphData.ioPorts && this.graphData.ioPorts.length > 0 && (this.graphData.customFuncGlsl || ( this.graphData.subGraphs && this.graphData.subGraphs.length > 0 && this.graphData.connections))) {
            for (i = 0; i < this.graphData.ioPorts.length; i++) {
                if (this.graphData.ioPorts[i] && this.graphData.ioPorts[i].name && this.graphData.ioPorts[i].type) {
                    if (this.graphData.ioPorts[i].type === 'sampler2D' && !this.graphData.ioPorts[i].name.startsWith('OUT_') && !this.graphData.customFuncGlsl) {
                        if (!(this.graphData.ioPorts[i].valueTex && this.graphData.ioPorts[i].valueTex instanceof Texture)) {
                            return false;
                        }
                    } else if (this.graphData.ioPorts[i].type === 'float' && !this.graphData.ioPorts[i].name.startsWith('OUT_') && !this.graphData.customFuncGlsl) {
                        if (!(this.graphData.ioPorts[i].valueX != undefined && typeof(this.graphData.ioPorts[i].valueX) === 'number')) {
                            return false;
                        }
                    } else if (this.graphData.ioPorts[i].type === 'vec2' && !this.graphData.ioPorts[i].name.startsWith('OUT_') && !this.graphData.customFuncGlsl) {
                        if (!(this.graphData.ioPorts[i].valueX != undefined && typeof(this.graphData.ioPorts[i].valueX) === 'number' &&
                              this.graphData.ioPorts[i].valueY != undefined && typeof(this.graphData.ioPorts[i].valueY) === 'number' )) {
                            return false;
                        }
                    } else if (this.graphData.ioPorts[i].type === 'vec3' && !this.graphData.ioPorts[i].name.startsWith('OUT_') && !this.graphData.customFuncGlsl) {
                        if (!(this.graphData.ioPorts[i].valueX != undefined && typeof(this.graphData.ioPorts[i].valueX) === 'number' &&
                              this.graphData.ioPorts[i].valueY != undefined && typeof(this.graphData.ioPorts[i].valueY) === 'number' &&
                              this.graphData.ioPorts[i].valueZ != undefined && typeof(this.graphData.ioPorts[i].valueZ) === 'number' )) {
                            return false;
                        }
                    } else if (this.graphData.ioPorts[i].type === 'vec4' && !this.graphData.ioPorts[i].name.startsWith('OUT_') && !this.graphData.customFuncGlsl) {
                        if (!(this.graphData.ioPorts[i].valueX != undefined && typeof(this.graphData.ioPorts[i].valueX) === 'number' &&
                              this.graphData.ioPorts[i].valueY != undefined && typeof(this.graphData.ioPorts[i].valueY) === 'number' &&
                              this.graphData.ioPorts[i].valueZ != undefined && typeof(this.graphData.ioPorts[i].valueZ) === 'number' &&
                              this.graphData.ioPorts[i].valueW != undefined && typeof(this.graphData.ioPorts[i].valueW) === 'number' )) {
                            return false;
                        }
                    }
                } else {
                    return false;
                }
            }

            if (this.graphData.customFuncGlsl) {
                if (typeof(this.graphData.customFuncGlsl) === 'number') {
                    return false;
                }
            } else {
                for (i = 0; i < this.graphData.connections.length; i++) {
                    if (this.graphData.connections[i]) {
                        if (!(this.graphData.connections[i].srcPortName && this.graphData.connections[i].dstPortName && (this.graphData.connections[i].srcIndex >= 0 || this.graphData.connections[i].dstIndex >= 0 ))) {
                            return false;
                        }
                    } else {
                        return false;
                    }
                }

                // infinite recursion protection
                // if no graphRootTime set, set it to current time
                if (!graphRootTime) {
                    graphRootTime = new Date().getTime();
                    this._tmpRootTime = graphRootTime;
                }
                for (i = 0; i < this.graphData.subGraphs.length; i++) {
                    if (this.graphData.subGraphs[i] && this.graphData.subGraphs[i] instanceof NodeMaterial && this.graphData.subGraphs[i].name) {
                        if (this.graphData.subGraphs[i]._tmpRootTime === graphRootTime) {
                            // recursion detected!
                            return false;
                        }

                        this._tmpRootTime = graphRootTime;

                        if (!(this.graphData.subGraphs[i].hasValidGraphData(graphRootTime))) {
                            return false;
                        }

                    } else {
                        return false;
                    }
                }
            }
            return true;
        }
        return false;
    },

    // NB only called when shader graph is valid and shader is marked as dirty
    initShader: function (device) {
        // this is where we could get a list of pass types in current app render pipeline (layers)
        // and query shader graph to check if there is a special output
        // var passes=[SHADER_DEPTH, SHADER_FORWARD, SHADER_FORWARDHDR, SHADER_PICK, SHADER_SHADOW];
        var passes = [SHADER_FORWARD];

        for (var i = 0; i < passes.length; i++) {
            var useSkin = false;

            if (this.meshInstances && this.meshInstances[0] && this.meshInstances[0].skinInstance) {
                useSkin = true; // TODO make this a variant?
            }

            var options = {
                skin: useSkin,
                shaderGraph: this,
                pass: passes[i],
                maxPixelLights: (this.maxPixelLights) ? this.maxPixelLights : 4,
                maxVertexLights: (this.maxVertexLights) ? this.maxVertexLights : 8
            };

            if (this._previewPort)
            {
                options.shaderGraph = this.graphData.subGraphs[0];
                options.previewPort = this._previewPort;
            }

            var shaderDefinition = programlib.node.createShaderDefinition(device, options);
            this.shaderVariants[passes[i]] = new Shader(device, shaderDefinition);
        }
    },

    _addioPort: function (type, name, value) {
        var ioPort;
        var doPush=true;
        if (value instanceof Texture) {
            ioPort = { type: type, name: name, valueTex: value };
        } else if (value instanceof Vec4) {
            ioPort = { type: type, name: name, valueX: value.x, valueY: value.y, valueZ: value.z, valueW: value.w };
        } else if (value instanceof Vec3) {
            ioPort = { type: type, name: name, valueX: value.x, valueY: value.y, valueZ: value.z };
        } else if (value instanceof Vec2) {
            ioPort = { type: type, name: name, valueX: value.x, valueY: value.y };
        } else if (typeof(value) === 'number') {
            ioPort = { type: type, name: name, valueX: value };
        } else {
            /*doPush=false;
            if (type === 'sampler2D') {
                ioPort = this._addioPort(type, name, 0);
            }else if (type === 'float') {
                ioPort = this._addioPort(type, name, 0);
            } else if (type === 'vec2') {
                ioPort = this._addioPort(type, name, Vec2(0, 0));
            } else if (type === 'vec3') {
                ioPort = this._addioPort(type, name, Vec3(0, 0, 0));
            } else if (type === 'vec4') {
                ioPort = this._addioPort(type, name, Vec4(0, 0, 0, 0));
            }
            else*/
            {
                ioPort = { type: type, name: name };
            }
        }

        var ret = this.graphData.ioPorts.length;

        this.graphData.ioPorts.push(ioPort);

        return ret;
    },

    addInput: function (type, name, value) {
        return this._addioPort(type, 'IN_' + name, value);
    },

    addOutput: function (type, name, value) {
        return this._addioPort(type, 'OUT_' + name, value);
    },

    addConstant: function (type, value) {
        return this._addioPort(type, 'CONST_' + type + '_' + this.graphData.ioPorts.length, value); // create a unique name
    },

    genCustomFuncVars: function () {
        var functionString = this.graphData.customFuncGlsl.trim();

        var head = functionString.split(")")[0];
        var retTypeAndFuncName = head.split("(")[0];
        var retType = retTypeAndFuncName.split(" ")[0];
        var params = head.split("(")[1].split(",");

        this.name = retTypeAndFuncName.split(" ")[1];
        // TODO check for function name clashes - maybe replace func name in function string with hash key?

        if (retType != "void") {
            this.addOutput(retType, 'ret');
        }

        for (var p = 0; p < params.length; p++) {
            var inOrOutAndTypeAndName = params[p].split(" ");

            if (inOrOutAndTypeAndName[0] === "") inOrOutAndTypeAndName.shift();

            if (inOrOutAndTypeAndName[0] === "out") {
                this.addOutput(inOrOutAndTypeAndName[1], inOrOutAndTypeAndName[2]);
                // this.defineOuputGetter(this.outputName[this.outputName.length - 1], this.outputName.length - 1);
            } else if (inOrOutAndTypeAndName[0] === "in") {
                this.addInput(inOrOutAndTypeAndName[1], inOrOutAndTypeAndName[2]);
                // this.defineInputSetter(this.inputName[this.inputName.length - 1], this.inputName.length - 1);
            } else {
                // unsupported parameter !!! TODO add support for more parameter types?
                console.warn('unsupported parameter in shader function!!!');
            }
        }
    },

    addSubGraph: function (graph) {
        var ret = this.graphData.subGraphs.length;
        this.graphData.subGraphs.push(graph);
        return ret;
    },

    connect: function (srcIndex, srcPortName, dstIndex, dstPortName, conIndex) {
        if (conIndex != undefined)
        {
            this.graphData.connections[conIndex].srcIndex=srcIndex;
            this.graphData.connections[conIndex].srcPortName=srcPortName;
            this.graphData.connections[conIndex].dstIndex=dstIndex;
            this.graphData.connections[conIndex].dstPortName=dstPortName;
        }
        else
        {
            var connection = { srcIndex: srcIndex, srcPortName: srcPortName, dstIndex: dstIndex, dstPortName: dstPortName };
            conIndex = this.graphData.connections.length;
            this.graphData.connections.push(connection);
        }
        return conIndex;
    },

    _getIoPortValueString: function (ioPort) {
        var ret;

        if (ioPort.type === 'float') {
            ret = 'float(' + ioPort.valueX + ')';
        } else if (ioPort.type === 'vec2') {
            ret = 'vec2(' + ioPort.valueX + ', ' + ioPort.valueY + ')';
        } else if (ioPort.type === 'vec3') {
            ret = 'vec3(' + ioPort.valueX + ', ' + ioPort.valueY + ', ' + ioPort.valueZ + ')';
        } else if (ioPort.type === 'vec4') {
            ret = 'vec4(' + ioPort.valueX + ', ' + ioPort.valueY + ', ' + ioPort.valueZ + ', ' + ioPort.valueW + ')';
        }

        return ret;
    },

    _generateSubGraphCall: function (inNames, outNames) {
        var i;
        var ioPort;
        var callString = '';

        for (i = 0; i < this.graphData.ioPorts.length; i++) {
            ioPort = this.graphData.ioPorts[i];
            if (ioPort.name.startsWith('OUT_ret')) {
                if (outNames[ioPort.name] != undefined) {
                    callString += outNames[ioPort.name] + ' = ';
                } else {
                    // I guess this is actually valid (return value not assigned to anything)
                }
            }
        }


        if (this.graphData.customFuncGlsl) {
            callString += this.name + '( ';
        } else {
            callString += this.name + '_' + this.id + '( ';
        }

        for (i = 0; i < this.graphData.ioPorts.length; i++) {
            ioPort = this.graphData.ioPorts[i];
            if (ioPort.name.startsWith('IN_')) {
                if (inNames && inNames[ioPort.name] != undefined) {
                    callString += inNames[ioPort.name] + ', ';
                } else {
                    // this is tricky - use varname and unique (temp) id
                    callString += ioPort.name + '_' + this.id + ', ';
                }
            }
        }

        for (i = 0; i < this.graphData.ioPorts.length; i++) {
            ioPort = this.graphData.ioPorts[i];
            if (ioPort.name.startsWith('OUT_') && !ioPort.name.startsWith('OUT_ret')) {
                if (outNames[ioPort.name] != undefined) {
                    callString += outNames[ioPort.name] + ', ';
                } else {
                    // this shouldn't be possible - all outputs from connected subgraphs will have a tmpVar declared.
                    // ERROR!!!!
                }
            }
        }

        if (callString.endsWith(', ')) callString = callString.slice(0, -2);

        callString += ' );\n';

        return callString;
    },

    // TODO: optimize using transient name map?
    getIoPortByName: function (name) {
        // convienient but not fast - TODO: optimize?
        return this.graphData.ioPorts.filter(function (ioPort) {
            return ioPort.name === name;
        })[0];
    },

    _generateSubGraphFuncs: function (depGraphFuncs, depioPortList) {
        var i;
        if (this.graphData.subGraphs != undefined) {
            for (i = 0; i < this.graphData.subGraphs.length; i++) {
                var subGraph = this.graphData.subGraphs[i];

                var name = subGraph.name;
                if (!subGraph.graphData.customFuncGlsl) {
                    name += '_' + subGraph.id;
                }

                if (depGraphFuncs[name] === undefined) {
                    if (subGraph.graphData.ioPorts) {
                        for (var v = 0; v < subGraph.graphData.ioPorts.length; v++) {
                            var ioPort = subGraph.graphData.ioPorts[v];
                            if (ioPort.name.startsWith('IN_') || (ioPort.name.startsWith('CONST_') && ioPort.type === 'sampler2D') ) {
                                var depioPort = 'uniform ' + ioPort.type + ' ' + ioPort.name + '_' + subGraph.id + ';\n';

                                depioPortList.push(depioPort);
                            }
                        }
                    }

                    depGraphFuncs[name] = subGraph._generateFuncGlsl();
                    subGraph._generateSubGraphFuncs(depGraphFuncs, depioPortList);
                }
            }
        }
    },

    generateRootDeclGlsl: function (previewPort) {
        var i;
        var ioPort;
        var generatedGlsl = '';

        // run through inputs (and const sampler2Ds) to declare uniforms - (default) values are set elsewhere
        for (i = 0; i < this.graphData.ioPorts.length; i++) {
            var matId = '_' + this.id;
            ioPort = this.graphData.ioPorts[i];
            if (ioPort.name.startsWith('IN_') || (ioPort.name.startsWith('CONST_') && ioPort.type === 'sampler2D')) {
                generatedGlsl += 'uniform ' + ioPort.type + ' ' + ioPort.name + matId + ';\n';
            }
        }
        // run through constants values are set here (except for textures - which have to be uniforms)
        for (i = 0; i < this.graphData.ioPorts.length; i++) {
            ioPort = this.graphData.ioPorts[i];
            if (ioPort.name.startsWith('CONST_') && (ioPort.type != 'sampler2D' )) {
                generatedGlsl += ioPort.type + ' ' + ioPort.name + ' = ' + this._getIoPortValueString(ioPort) + ';\n';
            }
        }

        // get all sub graph function definitions (including functions in sub graphs' sub graphs ...)
        // assumes names are unique - maybe should be id or key?
        var depGraphFuncs = {};
        var depioPortList = [];

        var depName = this.name;
        if (!this.graphData.customFuncGlsl) {
            depName += '_' + this.id;
        }
        depGraphFuncs[depName] = this._generateFuncGlsl(previewPort); // this should prevent infinite recursion?

        this._generateSubGraphFuncs(depGraphFuncs, depioPortList);

        // declare all dependancy textures
        for (i = 0; i < depioPortList.length; i++) {
            generatedGlsl += depioPortList[i];// .declString;
        }

        // add all the graph definitions
        var depGraphList = []; // reverse order
        for (var func in depGraphFuncs) {
            var funcString = '';

            if ( func.endsWith('PS') ) {
                funcString += '#ifdef SG_PS\n';
            } else if ( func.endsWith('VS') ) {
                funcString += '#ifdef SG_VS\n';
            }

            funcString += depGraphFuncs[func] + '\n';

            if ( func.endsWith('PS')  ) {
                funcString += '#endif //SG_PS\n';
            } else if ( func.endsWith('VS') ) {
                funcString += '#endif //SG_VS\n';
            }

            depGraphList.push(funcString);
        }
        var tLen = depGraphList.length; // need this because pop() reduces array length!
        for (i = 0; i < tLen; i++) {
            generatedGlsl += depGraphList.pop();
        }

        return generatedGlsl;
    },

    generateRootCallGlsl: function () {
        var generatedGlsl = '';

        // generate input and output names for function call and run through outputs to declare variables
        var inNames = {};
        var outNames = {};

        for (var i = 0; i < this.graphData.ioPorts.length; i++) {
            var matId = '_' + this.id;
            var ioPort = this.graphData.ioPorts[i];
            if (ioPort.name.startsWith('IN_')) {
                inNames[ioPort.name] = ioPort.name + matId;
            }
            if (ioPort.name.startsWith('OUT_')) {
                generatedGlsl += ioPort.type + ' ' + ioPort.name + ';\n';
                outNames[ioPort.name] = ioPort.name;
            }
        }

        generatedGlsl += this._generateSubGraphCall(inNames, outNames);

        return generatedGlsl;
        // NB the pass (or layer) will decide which output is used and how
    },

    _generateFuncGlsl: function (previewPort) {
        var i;
        var ioPort;
        var generatedGlsl;

        if (this.graphData.customFuncGlsl) {
            // custom and built-in
            generatedGlsl = this.graphData.customFuncGlsl.trim();
        } else if (this.graphData.subGraphs) {
            // graph
            // function head
            var retUsed = false;

            for (i = 0; i < this.graphData.ioPorts.length; i++) {
                ioPort = this.graphData.ioPorts[i];
                if (ioPort.name.startsWith('OUT_ret')) {
                    generatedGlsl = ioPort.type + ' ';
                    retUsed = true;
                }
            }

            if (retUsed === true) {
                generatedGlsl += this.name + '_' + this.id + '( ';
            } else {
                generatedGlsl = 'void ' + this.name + '_' + this.id + '( ';
            }

            for (i = 0; i < this.graphData.ioPorts.length; i++) {
                ioPort = this.graphData.ioPorts[i];
                if (ioPort.name.startsWith('IN_')) {
                    generatedGlsl += 'in ' + ioPort.type + ' ' + ioPort.name + ', ';
                }
            }

            for (i = 0; i < this.graphData.ioPorts.length; i++) {
                ioPort = this.graphData.ioPorts[i];
                if (ioPort.name.startsWith('OUT_')) {
                    if (!ioPort.name.startsWith('OUT_ret')) {
                        generatedGlsl += 'out ' + ioPort.type + ' ' + ioPort.name + ', ';
                    }
                }
            }

            if (generatedGlsl.endsWith(', ')) generatedGlsl = generatedGlsl.slice(0, -2);

            generatedGlsl += ' ) {\n';

            // temporary structures - with temp scope only in parsing function
            var tmpVarCounter = 0;
            var srcTmpVarMap = [];
            var dstTmpVarMap = [];
            var graphOutputVarTmpVarMap = {};

            var srcConnectedMap = [];
            var dstConnectedMap = [];

            // create temp vars and graph traversal data (iterate one more time for preview out)
            for (i = 0; i < this.graphData.connections.length + 1; i++) {
                var con;
                if (i === this.graphData.connections.length)
                {
                    if (previewPort)
                    {
                        con = { srcIndex: previewPort.index, srcPortName: previewPort.name, dstIndex: -1, dstPortName: 'OUT_preview' };
                    }
                    else
                    {
                        // no preview - skip
                        continue;
                    }
                }
                else
                {
                    con = this.graphData.connections[i];
                }
                // if there is a src sub graph assign tmp var to all of it's outputs
                if (con.srcIndex >= 0) {
                    var srcSubGraph = this.graphData.subGraphs[con.srcIndex];
                    if (srcTmpVarMap[con.srcIndex] === undefined) {
                        srcTmpVarMap[con.srcIndex] = {};
                        for (var o = 0; o < srcSubGraph.graphData.ioPorts.length; o++) {
                            var outputVar = srcSubGraph.graphData.ioPorts[o];
                            if (outputVar.name.startsWith('OUT_')) {
                                generatedGlsl += outputVar.type + ' temp_' + outputVar.type + '_' + tmpVarCounter + ';\n';
                                srcTmpVarMap[con.srcIndex][outputVar.name] = 'temp_' + outputVar.type + '_' + tmpVarCounter;
                                tmpVarCounter++;
                            }
                        }
                    }
                }
                // if there is a dst sub graph hook up with src sub graph output or root graph var
                if (con.dstIndex >= 0) {
                    if (con.srcIndex >= 0) {
                        // src sub graph output
                        if (srcConnectedMap[con.srcIndex] === undefined) srcConnectedMap[con.srcIndex] = [];
                        srcConnectedMap[con.srcIndex].push(con.dstIndex);

                        if (dstConnectedMap[con.dstIndex] === undefined) dstConnectedMap[con.dstIndex] = [];
                        dstConnectedMap[con.dstIndex].push(con.srcIndex);

                        if (dstTmpVarMap[con.dstIndex] === undefined) dstTmpVarMap[con.dstIndex] = {};
                        dstTmpVarMap[con.dstIndex][con.dstPortName] = srcTmpVarMap[con.srcIndex][con.srcPortName];
                    } else {
                        // root graph input/const var
                        if (dstTmpVarMap[con.dstIndex] === undefined) dstTmpVarMap[con.dstIndex] = {};
                        dstTmpVarMap[con.dstIndex][con.dstPortName] = con.srcPortName;
                    }
                } else {
                    if (con.srcIndex >= 0) {
                        // root graph output var
                        graphOutputVarTmpVarMap[con.dstPortName] = srcTmpVarMap[con.srcIndex][con.srcPortName];
                    } else {
                        // invalid connection?!
                    }
                }
            }

            // sort sub graphs for correct ordering
            var subGraphOnListFlags = [];
            var subGraphList = [];

            // it should not be possible for the the number of iterations to exceeds the number of connections - unless there is a cyclic dependency
            var whileLoopCount = 0;

            while (subGraphList.length < this.graphData.subGraphs.length && whileLoopCount < this.graphData.connections.length) {
                whileLoopCount++;

                for (i = 0; i < this.graphData.subGraphs.length; i++) {
                    if (subGraphOnListFlags[i] != true) {
                        var allInputsOnList = true;
                        if (dstConnectedMap[i] != undefined) {
                            for (var n = 0; n < dstConnectedMap[i].length; n++) {
                                var connectedSrcIndex = dstConnectedMap[i][n];
                                if (subGraphOnListFlags[connectedSrcIndex] != true) {
                                    allInputsOnList = false;
                                    break;
                                }
                            }
                        }
                        if (allInputsOnList === true) {
                            subGraphList.push(i);
                            subGraphOnListFlags[i] = true;
                        }
                    }
                }
            }

            // sub graph function calls
            for (i = 0; i < subGraphList.length; i++) {
                var subGraphIndex = subGraphList[i];

                // skip if no outputs
                if (srcTmpVarMap[subGraphIndex] != undefined) {
                    var func = this.graphData.subGraphs[subGraphIndex].name;

                    if ( func.endsWith('PS') ) {
                        generatedGlsl += '#ifdef SG_PS\n';
                    } else if ( func.endsWith('VS') ) {
                        generatedGlsl += '#ifdef SG_VS\n';
                    }

                    generatedGlsl += this.graphData.subGraphs[subGraphIndex]._generateSubGraphCall(dstTmpVarMap[subGraphIndex], srcTmpVarMap[subGraphIndex]);

                    if ( func.endsWith('PS')  ) {
                        generatedGlsl += '#endif //SG_PS\n';
                    } else if ( func.endsWith('VS') ) {
                        generatedGlsl += '#endif //SG_VS\n';
                    }
                }
            }

            var previewFlag = false;

            // output assignment
            for (i = 0; i < this.graphData.ioPorts.length; i++) {
                ioPort = this.graphData.ioPorts[i];
                if (ioPort.name.startsWith('OUT_') && !ioPort.name.startsWith('OUT_ret')) {
                    if (graphOutputVarTmpVarMap[ioPort.name])
                    {
                        generatedGlsl += ioPort.name + ' = ' + graphOutputVarTmpVarMap[ioPort.name] + ';\n';
                    }
                    else
                    {
                        generatedGlsl += ioPort.name + ' = ' + this._getIoPortValueString(ioPort) + ';\n';   
                    }
                    if (previewPort && ioPort.name === 'OUT_fragOut')
                    {
                        previewFlag = true;
                    }
                }
            }

            if (previewPort)
            {
                if (previewFlag)
                {
                    generatedGlsl += 'OUT_fragOut = ' + graphOutputVarTmpVarMap.OUT_preview + ';\n';
                }
                else
                {
                    generatedGlsl += 'vec4 OUT_fragOut = ' + graphOutputVarTmpVarMap.OUT_preview + ';\n';
                }
            }

            generatedGlsl += '}\n';
        }

        return generatedGlsl;
    }

});

var shadergraph = {};
/*
shadergraph.graphCounter = 0;

shadergraph.nodeRegistry = {};

shadergraph._getNode = function (name, funcString, declString) {
    if (!this.nodeRegistry[name]) {
        this.nodeRegistry[name] = new NodeMaterial(funcString, declString);
    }

    return this.nodeRegistry[name];
};

shadergraph.start = function () {
    // check current graph is null?
    shadergraph.graph = this._getNode('graphRoot_' + shadergraph.graphCounter);
    shadergraph.graph.name = 'graphRoot_' + shadergraph.graphCounter;
};

shadergraph.end = function () {
    var ret = shadergraph.graph;
    shadergraph.graph = null;
    shadergraph.graphCounter++;
    return ret;
};

shadergraph.textureSample2D = function (name, texture, uv) {

    var texSampNode = this.graph.addSubGraph(this._getNode('texSample', 'vec4 texSample(in sampler2D tex, in vec2 uv, out vec3 color, out float alpha) {\n vec4 samp=texture2D(tex, uv);\n color=samp.rgb;\n alpha=samp.a;\n return samp;\n}'));

    // assumes name is unique TODO: verify?
    var ioPort = this.graph.addInput('sampler2D', name, texture);
    this.graph.connect(-1, ioPort.name, texSampNode, 'IN_tex');
    this.graph.connect(uv, 'OUT_ret', texSampNode, 'IN_uv');

    return texSampNode;
};

shadergraph.customNode = function (name, f, d) {
    var nodeIndex = this.graph.addSubGraph(this._getNode(name, f, d));
    return nodeIndex;
};

Object.defineProperty(shadergraph, 'uv0', {
    get: function () {
        var nodeIndex = this.graph.addSubGraph(this._getNode('uv0', 'vec2 uv0() { return vUv0; }'));
        return nodeIndex;
    }
});

Object.defineProperty(shadergraph, 'worldPosPS', {
    get: function () {
        var nodeIndex = this.graph.addSubGraph(this._getNode('worldPosPS', 'vec3 wpPS() { return vPosition; }'));
        return nodeIndex;
    }
});

Object.defineProperty(shadergraph, 'worldNormPS', {
    get: function () {
        var nodeIndex = this.graph.addSubGraph(this._getNode('worldNormPS', 'vec3 wnPS() { return vNormal; }'));
        return nodeIndex;
    }
});

Object.defineProperty(shadergraph, 'worldPosVS', {
    get: function () {
        var nodeIndex = this.graph.addSubGraph(this._getNode('worldPosVS', 'vec3 wpVS() { return getWorldPositionNM(); }'));
        return nodeIndex;
    }
});

Object.defineProperty(shadergraph, 'worldNormVS', {
    get: function () {
        var nodeIndex = this.graph.addSubGraph(this._getNode('worldNormVS', 'vec3 wnVS() { return getWorldNormalNM(); }'));
        return nodeIndex;
    }
});

shadergraph.param = function (type, name, value) {
    // assumes name is unique TODO: verify this
    var ioPort = this.graph.addInput(type, name, value);
    return ioPort;
};

shadergraph.connectFragOut = function (nodeIndex, name) {
    // assumes this is only called once per graph TODO: verify this
    var ioPort = this.graph.addOutput('vec4', 'fragOut', new Vec4(0, 0, 0, 0));
    this.graph.connect(nodeIndex, (name) ? 'OUT_' + name : 'OUT_ret', -1, ioPort.name);
};

shadergraph.connectVertexOffset = function (nodeIndex, name) {
    // assumes this is only called once per graph TODO: verify this
    var ioPort = this.graph.addOutput('vec3', 'vertOff', new Vec3(0, 0, 0));
    this.graph.connect(nodeIndex, (name) ? 'OUT_' + name : 'OUT_ret', -1, ioPort.name);
};

shadergraph.connectCustom = function (destNodeIndex, destName, nodeIndex_or_param, name) {
    if (typeof(nodeIndex_or_param) === 'number') {
        var nodeIndex = nodeIndex_or_param;
        this.graph.connect(nodeIndex, (name) ? 'OUT_' + name : 'OUT_ret', destNodeIndex, 'IN_' + destName);
    } else {
        var ioPort = nodeIndex_or_param;
        this.graph.connect(-1, ioPort.name, destNodeIndex, 'IN_' + destName);
    }
};
*/
export { NodeMaterial, shadergraph };
