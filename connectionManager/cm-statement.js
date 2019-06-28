var sqlok;
module.exports = function(RED) {
    function cmStatementNode(n) {
        RED.nodes.createNode(this,n);
    	this.log("Copyright 2019 Jaroslav Peter Prib");
    	var node=Object.assign(this,n);
    	node.prepareSQL=(node.prepare=="yes");
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
        var setParam;
   		switch (node.param) {
   			case 'msg.payload':
   				setParam=function(msg) {return msg.payload;};
   				break;
   			case 'msg.param':
   				setParam=function(msg) {return msg.param;};
   				break;
   			case 'none': 
   				setParam=function(msg) {return [];};
   				break
   			default:
   				setParam=function(msg) {node.status({ fill: 'red', shape: 'ring', text: "Parameter type not selected" });};
				break;
    	}
    	if(node.prepareSQL) {
			node.status({ fill: 'yellow', shape: 'ring', text: "Prepare not initialized" });
    	}
       	node.on('input', function (msg) {
       		if(!msg.cm) {
       			msg.error="no connections established by previous nodes";
       			node.send([null,msg]);
       			return;
       		}
       		msg.cm.query.apply(node,[msg,node.connection,node.statement,setParam(msg),
				function (result) {
					msg.result=result;
					node.send([msg]);
					if(!sqlok) {
						node.status({ fill: 'green', shape: 'ring', text: "OK" });
					}
				},
       			function(result,err) {
					msg.result=result;
					msg.error=err;
					if(node.isLogError) node.error(JSON.stringify(err));
					node[node.onErrorAction||"terminate"].apply(node,[msg]);
					node.status({ fill: 'red', shape: 'ring', text: "Error" });
					sqlok=false;
				}
       		]);
       	});
    }
    RED.nodes.registerType("cm-statement",cmStatementNode);
};
