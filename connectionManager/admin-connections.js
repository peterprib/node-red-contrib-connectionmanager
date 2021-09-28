const logger = new (require("node-red-contrib-logger"))("Admin Connections");
logger.sendInfo("Copyright 2020 Jaroslav Peter Prib");

module.exports = function(RED) {
    function AdminConnectionNode(n) {
        RED.nodes.createNode(this,n);
        var node=Object.assign(this,n);
        node.on('input', function (msg) {
        	switch(msg.topic) {
/*        		case 'update': 
        			RED.nodes.eachNode(function(n) {
        				if(n.type!=="Connection Manager") return;
           				if(n.name!==msg.payload.name) return;
           			 	var cmNode=RED.nodes.getNode(n.id);
        				if(cmNode) {
        					cmNode.poolsize=msg.payload.poolsize;
        					cmNode.connectionPool.setSize();
            				msg.payload.push(Object.assign({name:n.name,poolsize:cmNode.poolsize}));
        				} else {
        					msg.payload.push({name:n.name,error:"node not found "+n.id});
        				}
        			});
        			break;
*/        		case 'list':
        			msg.payload=[];
        			RED.nodes.eachNode(function(n) {
        				if(n.type!=="Connection Manager") return;
        				let cmNode=RED.nodes.getNode(n.id);
        				if(cmNode) {
            				msg.payload.push(Object.assign({name:n.name,poolsize:cmNode.poolsize},cmNode.connectionPool.getDetails()));
        				} else {
        					msg.payload.push({name:n.name,error:"node not found "+n.id});
        				}
        			});
        			break;
				case 'test':
        			RED.nodes.eachNode(function(n) {
        				if(n.type!=="Connection Manager") return;
        				let cmNode=RED.nodes.getNode(n.id);
        				if(cmNode) {
        					node.testConnection(()=>{
        							const out=Object.assign({},msg,
        									{payload:{name:n.name,poolsize:cmNode.poolsize}}
        								);
        							node.send(out);
        						},
        						(err)=>{
        							const out=Object.assign({},msg,
        									{error:err,payload:{name:n.name,poolsize:cmNode.poolsize}}
        								);
        							logger.error(msg)
        							node.send(out);
        						});
        				}
        			});
        			return;
				case 'toggleDebug':
					var toggled=false;
        			RED.nodes.eachNode(function(n) {
        				if(toggled) return;
        				if(n.type!=="Connection Manager") return;
        				toggled=true;
        				var cmNode=RED.nodes.getNode(n.id);
        				cmNode.toggleDebug();
        			});
        			msg.payload="debug toggled";
        			break;
        		case 'releasestale':
        			RED.nodes.eachNode(function(n) {
        				if(n.type!=="Connection Manager") return;
        				var cmNode=RED.nodes.getNode(n.id);
        				cmNode.connectionPool.releaseStaleConnections.apply(cmNode.connectionPool);
        			});
        			msg.payload="release stale connections initiated";
        		case 'releaseFree':
        			RED.nodes.eachNode(function(n) {
        				if(n.type!=="Connection Manager") return;
        				var cmNode=RED.nodes.getNode(n.id);
        				cmNode.connectionPool.releaseFreeConnections.apply(cmNode.connectionPool);
        			});
        			msg.payload="release stale connections initiated";
        	}
			node.send(msg);
        });
    }
    RED.nodes.registerType(logger.label,AdminConnectionNode);
};