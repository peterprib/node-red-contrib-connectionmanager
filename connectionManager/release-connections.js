const logger = new (require("node-red-contrib-logger"))("Release Connections");
logger.sendInfo("Copyright 2020 Jaroslav Peter Prib");

module.exports = function(RED) {
    function ReleaseConnectionNode(n) {
        RED.nodes.createNode(this,n);
        var node=Object.assign(this,n);
        node.rollbackTransaction=(node.rollback=="yes");
        node.on('input', function (msg) {
        	if(msg.cm) {
        		if(logger.active) logger.send("input release");
        		msg.cm.release.apply(node,[msg,
        	    	(results)=>node.send([msg]),  // as no errors  results are known 
        	    	(results,errors)=>{
        	           	msg.error=errors||"no error message returned";
                		logger.send({label:"input release",error:msg.error,results:results});
        	           	node.error(JSON.stringify({error:msg.errors,results:results}));
        	           	node.send([null,msg]);
    					node.status({ fill: 'red', shape: 'ring', text: "Error check log" });

        	    	}
        	    ]);
        	} else {
        		if(logger.active) logger.send("input no cm therefore no release");
            	node.send([msg]);
        	}
        });
    }
    RED.nodes.registerType(logger.label,ReleaseConnectionNode);
};