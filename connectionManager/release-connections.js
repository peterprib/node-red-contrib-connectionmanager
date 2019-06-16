module.exports = function(RED) {
    function ReleaseConnectionNode(n) {
        RED.nodes.createNode(this,n);
        this.log("Copyright 2019 Jaroslav Peter Prib");
        var node=Object.assign(this,n);
        node.rollbackTransaction=(node.rollback=="yes");
        node.on('input', function (msg) {
        	if(msg.cm) {
        		msg.cm.release.apply(node,[msg,
        	    	(results)=>node.send([msg]),  // as no errors  results are known 
        	    	(results,errors)=>{
        	           	msg.error=errors||"no error message returned";
        	           	node.error(JSON.stringify({error:msg.errors,results:results}));
        	           	node.send([null,msg]);
        	    	}
        	    ]);
        	} else {
            	node.send([msg]);
        	}
        });
    }
    RED.nodes.registerType("Release Connections",ReleaseConnectionNode);
};