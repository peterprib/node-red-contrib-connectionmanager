const logger = new (require("node-red-contrib-logger"))("cm-statement");
logger.sendInfo("Copyright 2020 Jaroslav Peter Prib");

function Mapping(msg) {
	let params=[];
	this.mappingCompiled.forEach((r)=>params.push(r.apply(this,[msg])));
	this.debug("Mapping out: "+JSON.stringify(params));
	return params;
}
function processArray(node,msg,source,index) {
	if(logger.active) logger.send({label:"processArray",msg:msg._msgid});
	if(index>=source.length) {
		node.send([msg]);
		if(msg.error) {
			error(node,msg);
		} else if(!node.sqlok) {
			node.status({ fill: 'green', shape: 'ring', text: "OK" });
		}
		return;
	}
	try{
		msg.cm.requestTS={before:new Date()};
		msg.cm.query.apply(node,[msg,node.connection,node.statement,node.mappingCompiled.apply(node,[node,msg,source[index]]),
			(result)=>{
				if(logger.active) logger.send({label:"processArray query result",msg:msg._msgid});
				msg.cm.requestTS.after=new Date();
				msg.cm.requestTS.elapse=msg.requestTS.after-msg.requestTS.before;
				msg.result.push(result);
				processArray.apply(this,[node,msg,source,++index]);
			},			
			(result,err)=>{
				if(logger.active) logger.send({label:"processArray query error",msg:msg._msgid,error:err});
				msg.cm.requestTS.after=new Date();
				msg.cm.requestTS.elapse=msg.cm.requestTS.after-msg.cm.requestTS.before;				msg.result.push(result);
				msg.error=msg.error||[];
				msg.error[index]=err;
				if(node.isLogError) node.error(JSON.stringify(err));
				processArray.apply(this,[node,msg,source,++index]);
			}
  		]);
  	} catch(ex) {
		msg.result.push(null);
		msg.error=msg.error||[];
		msg.error[index]=ex.message;
		error(node,msg);
  	}
}
function error(node,msg,result,err) {
	if(logger.active) logger.send({label:"error",msg:msg._msgid,result:result,error:err})
	if(!node.sqlok) {
		node.sqlok=false;
		node.status({ fill: 'red', shape: 'ring', text: "Error" });
	}
	try{
		if(result) msg.result=result;
		if(err) msg.error=err;
		if(node.isLogError) node.error(JSON.stringify(err));
		node.onErrorActionFunction(msg);
	} catch(ex){
		logger.sendError("query error handling failure "+ex.message);
	}
}
module.exports = function(RED) {
	function cmStatementNode(n) {
		RED.nodes.createNode(this,n);
		var node=Object.assign(this,n);
		node.prepareSQL=(node.prepare=="yes");
		node.sqlok=false;
		node.isLogError=(node.logError=="yes");
		node.terminate=function(msg) {
			node.error("Message terminated due to an error", msg);
			if(msg.cm) {
				node.error("releasing connections as message terminated");
				msg.cm.release.apply(node,[msg,
					()=>{return;},		  // ok
					(err)=>{node.error(err);}   //error
				]);
			}
		};
		node.both=function(msg) {
			if(logger.active) logger.send({label:"on error both",msg:msg._msgid});
			node.send([msg,msg]);
		};
		node.onlyWithRelease=function(msg) {
	   		node.error("releasing connections as error with release");
	   		msg.cm.release.apply(node,[msg,
	   			function() {					// ok
					node.send([null,msg]);
	   			},		 
	   			function(e) { 					//error
	   				node.error("rollback error "+e);
	   				node.send([null,msg]);
	   			}   
	   		]);
		};
		node.only=function(msg) {
			if(logger.active) logger.send({label:"on error only",msg:msg._msgid});
		 	node.send([null,msg]);
		};
		node.ignore=function(msg) {
			if(logger.active) logger.send({label:"on error ingore",msg:msg._msgid});
			node.send([msg]);
		};
		const callError=node.onErrorAction||"terminate";
		node.log("set onErrorAction "+callError);
		node.onErrorActionFunction=node[callError].bind(node);
		let setParam;
   		switch (node.param) {
   			case 'msg.payload':
   				setParam=function(node,msg) {return msg.payload;};
   				break;
   			case 'msg.param':
   				setParam=function(node,msg) {return msg.param;};
   				break;
   			case 'none': 
   				setParam=function() {return null;};
   				break
   			case 'arraymapping': 
				let paramText="(node,msg,r)=>{ return [";
   				try{
	   				node.getArraySource=eval("(node,msg,flow,global,env)=>{return "+node.arraySource+";}");
		   			node.mapping.forEach((c)=>{
		   				if(c==-1) {
		   					paramText+="msg.topic,";
		   				} else {
		   					paramText+="r["+c+"],";
		   				}
		   			});
					paramText=paramText.slice(0, -1)+"];}";
	   				node.log("Mapping : "+paramText);
					node.mappingCompiled=eval(paramText);
				} catch(e) {
					node.mappingCompiled=function(){return undefined;};
					node.error('array source failed error: '+e);
					node.status({ fill: 'red', shape: 'ring', text: "Array mapping failed check log for details" });
   				}
   				break;
   			case 'mapping':
				try{
					let paramText="(node,msg)=>{ return ["+node.mapping.join(",")+"];}";
		   			node.log("Mapping : "+paramText);
					node.mappingCompiled=eval(paramText);
					setParam=node.mappingCompiled;
				} catch(e) {
					node.mappingCompiled=function(){return undefined;};
					node.error('array source failed error: '+e);
					node.status({ fill: 'red', shape: 'ring', text: "Mapping failed check log for details" });
   				}
   				break
   			default:
   				node.status({ fill: 'red', shape: 'ring', text: "Parameter type not selected, defaulting to payload" });
   				setParam=function(msg) {return msg.payload;};
				break;
		}
		if(node.prepareSQL) {
			node.status({ fill: 'yellow', shape: 'ring', text: "Prepare not initialized" });
		}
		
		node.flow={
			get:(()=>node.context().flow.get.apply(node,arguments))
		};
		node.global={
			get:()=>(node.context().global.get.apply(node,arguments))
		};
		node.env={
			get:((envVar)=>node._flow.getSetting(envVar))
		};
		
	   	node.on('input', function (msg) {
	   		if(!msg.cm) {
	   			msg.error="no connections established by previous nodes";
	   			node.send([null,msg]);
	   			return;
	   		}
	   		if(node.getArraySource) {  // implies array mapping
				if(logger.active) logger.send({label:"query array",msg:msg._msgid});
	   			msg.result=[];
	   			delete msg.error;
	   			try{
	   				processArray.apply(this,[node,msg,node.getArraySource(node,msg,node.flow,node.global,node.env),0]);
	   			} catch(ex) {
					error(node,msg,null,ex.message)
	   			}
	   			return;
	   		} 
			if(logger.active) logger.send({label:"query",msg:msg._msgid});
	   		msg.cm.query.apply(node,[msg,node.connection,node.statement,setParam.apply(node,[node,msg]),
				function (result) {
					if(logger.active) logger.send({label:"query OK",msg:msg._msgid});
					msg.result=result;
					node.send([msg]);
					if(!node.sqlok) {
						node.status({ fill: 'green', shape: 'ring', text: "OK" });
						node.sqlok=true;
					}
				},
	   			function(result,err) {
					if(logger.active) logger.send({label:"query error",msg:msg._msgid,error:err});
					error(node,msg,result,err);
				}
	   		]);
	   	});
	}
	RED.nodes.registerType(logger.label,cmStatementNode);
};
