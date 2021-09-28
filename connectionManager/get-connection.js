const logger = new (require("node-red-contrib-logger"))("Get Connection");
logger.sendInfo("Copyright 2020 Jaroslav Peter Prib");

function connectionName(node) {
	if(node.connectionNode) {
		try{
			return ( node.connectionNode.name||node.connectionNode.id );
		} catch(e) {
			return "*** error: "+e;
		}
	}
	return "*** no connection";
}
module.exports = function(RED) {
	function GetConnectionNode(n) {
		RED.nodes.createNode(this,n);
		let node=Object.assign(this,n);
		node.status({ fill: 'yellow', shape: 'ring', text: "Initialising" });
		node.connectionNode=RED.nodes.getNode(node.connection);
		 if(node.connectionNode==null) {
			 const err= "Connection  to "+ node.connection +" not found" ;
			 node.status({ fill: 'red', shape: 'ring', text:err})
			 logger.error({label:"setup",error:err,node:node})
			 return;
		 } 
		 node.noConnection=function(node,msg){
			msg.error="no connection";
			node.send([null,msg]);
		}
		node.connected=function(msg){
			if(logger.active) logger.send({label:"connected"})
			const node=this;
			node.connectionNode.setMsg.apply(node,[msg,
				function() {
					if(logger.active) logger.send({label:"connected sending message"})
					node.send(msg);
					if(node.failedLastTime!==false) {
				   		node.failedLastTime=false;
				   		node.status({ fill: 'green', shape: 'ring', text: "Connection to "+ connectionName(node) });
					}
				},
				function(e) {
					if(logger.active) logger.send({label:"connected error"})
					if(node.failedLastTime!==true) {
						node.failedLastTime=true;
						node.status({ fill: 'red', shape: 'ring', text: "Connecting to "+connectionName(node) });
						node.error("get connection failed: "+e);
						msg.error=e;
					}
					node.send([null,msg]);
				}
			]);
		}
		node.msgAction=node.connected.bind(node);
		node.startup=function(){
			if(logger.active) logger.send({label:"node.startup",id:node.connection});
			node.connectionNode.testConnection(()=>{
//				node.msgAction=connected;
				node.status({ fill: 'green', shape: 'ring', text: "Connection to "+ connectionName(node) });
			},(err)=>{
				node.status({ fill: 'red', shape: 'ring', text: "error connecting "+ err });
				 logger.error({label:"node.startup test connection",error:err})
			});
		}
		RED.events.on("flows:started",node.startup);
		node.on('close', ()=>{
			RED.events.removeListener("flows:started", node.startup);
		})
		node.failedLastTime=false;
		node.on('input', node.msgAction);
	}
	RED.nodes.registerType(logger.label,GetConnectionNode);
};