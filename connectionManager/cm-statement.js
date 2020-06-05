const logger = new (require("node-red-contrib-logger"))("cm-statement");
logger.sendInfo("Copyright 2020 Jaroslav Peter Prib");

const ts=(new Date().toString()).split(' ');
console.log([parseInt(ts[2],10),ts[1],ts[4]].join(' ')+" - [info] cm-statement Copyright 2019 Jaroslav Peter Prib");

function Mapping(msg) {
	let params=[];
	this.mappingCompiled.forEach((r)=>params.push(r.apply(this,[msg])));
	this.debug("Mapping out: "+JSON.stringify(params));
	return params;
}
function processArray(node,msg,source,index) {
	if(index>=source.length) {
		node.send([msg]);
		if(msg.error) {
			node.status({ fill: 'red', shape: 'ring', text: "Error" });
			node.lastError=true
			node[node.onErrorAction||"terminate"].apply(node,[msg]);
		} else {
			if(node.lastError) {
				node.status({ fill: 'green', shape: 'ring', text: "OK" });
			}
		}
		return;
	}
	try{
		msg.cm.requestTS={before:new Date()};
		msg.cm.query.apply(node,[msg,node.connection,node.statement,node.mappingCompiled.apply(node,[node,msg,source[index]]),
			(result)=>{
				msg.cm.requestTS.after=new Date();
				msg.cm.requestTS.elapse=msg.requestTS.after-msg.requestTS.before;
				msg.result.push(result);
				processArray.apply(this,[node,msg,source,++index]);
				if(!node.sqlok) {
					node.status({ fill: 'green', shape: 'ring', text: "OK" });
					node.sqlok=true;
				}
			},			
			(result,err)=>{
				msg.cm.requestTS.after=new Date();
				msg.cm.requestTS.elapse=msg.requestTS.after-msg.requestTS.before;				msg.result.push(result);
				msg.error=msg.error||[];
				msg.error[index]=err;
				if(node.isLogError) node.error(JSON.stringify(err));
			}
  		]);
  	} catch(e) {
		msg.result.push(null);
		msg.error=msg.error||[];
		msg.error[index]=e.message;
		if(node.isLogError) node.error(JSON.stringify(e.message));
		if(node.sqlok) {
			node.status({ fill: 'red', shape: 'ring', text: "Error" });
			node.sqlok=false;
		}
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
        			function() {return;},          // ok
        			function(e) {node.error(e);}   //error
        		]);
        	}
        };
        node.both=function(msg) {
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
	     	node.send([null,msg]);
        };
        node.ignore=function(msg) {
        	node.send([msg]);
        };
        node.log("set onErrorAction "+n.onErrorAction);
        node.onErrorAction=n.onErrorAction;
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
       			msg.result=[];
       			delete msg.error;
       			try{
       				processArray.apply(this,[node,msg,node.getArraySource(node,msg,node.flow,node.global,node.env),0]);
       			} catch(e) {
					msg.error=e.toString();
					if(node.isLogError) node.error(e.toString());
					node[node.onErrorAction||"terminate"].apply(node,[msg]);
					node.status({ fill: 'red', shape: 'ring', text: "Error" });
       			}
       			return;
       		} 
	   		msg.cm.query.apply(node,[msg,node.connection,node.statement,setParam.apply(node,[node,msg]),
					function (result) {
					msg.result=result;
					node.send([msg]);
					if(!node.sqlok) {
						node.status({ fill: 'green', shape: 'ring', text: "OK" });
						node.sqlok=true;
					}
				},
       			function(result,err) {
					msg.result=result;
					msg.error=err;
					if(node.isLogError) node.error(JSON.stringify(err));
					node[node.onErrorAction||"terminate"].apply(node,[msg]);
					node.status({ fill: 'red', shape: 'ring', text: "Error" });
					node.sqlok=false;
				}
       		]);
       	});
    }
    RED.nodes.registerType(logger.label,cmStatementNode);
};
