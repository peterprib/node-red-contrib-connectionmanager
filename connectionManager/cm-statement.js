
module.exports = function(RED) {
    function cmStatementNode(n) {
        RED.nodes.createNode(this,n);
    	this.log("Copyright 2019 Jaroslav Peter Prib");
    	var node=Object.assign(this,n);
    	node.prepareSQL=(node.preapare=="yes");
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
       	node.on('input', function (msg) {
       		if(!msg.cm) {
       			msg.error="no connections established by previous nodes";
       			node.send([null,msg]);
       			return;
       		}
       		switch (node.param) {
       			case 'msg.payload':
       				var param=msg.payload;
       				break;
       			case 'msg.param':
       				var param=msg.param;
       				break;
       			case 'none': 
       			default:
       				var param=[];
       				break;
       		}
       		msg.cm.query.apply(node,[msg,node.connection,node.statement,param,
				function (result) {
					msg.result=result;
					node.send([msg]);
				},
       			function(result,err) {
					msg.result=result
					msg.error=err;
					node[node.onErrorAction||"terminate"].apply(node,[msg]);
				}
       		]);
       	});
    }
    RED.nodes.registerType("cm-statement",cmStatementNode);
};
