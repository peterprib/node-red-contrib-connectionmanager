module.exports = function(RED) {
    function AdminConnectionNode(n) {
        RED.nodes.createNode(this,n);
        this.log("Copyright 2019 Jaroslav Peter Prib");
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
        	}
			node.send(msg);
        });
    }
    RED.nodes.registerType("Admin Connections",AdminConnectionNode);
};