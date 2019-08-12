const ts=(new Date().toString()).split(' ');
console.log([parseInt(ts[2],10),ts[1],ts[4]].join(' ')+" - [info] admin-connection Copyright 2019 Jaroslav Peter Prib");
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
        				var cmNode=RED.nodes.getNode(n.id);
        				if(cmNode) {
            				msg.payload.push(Object.assign({name:n.name,poolsize:cmNode.poolsize},cmNode.connectionPool.getDetails()));
        				} else {
        					msg.payload.push({name:n.name,error:"node not found "+n.id});
        				}
        			});
        			break;
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
    RED.nodes.registerType("Admin Connections",AdminConnectionNode);
};