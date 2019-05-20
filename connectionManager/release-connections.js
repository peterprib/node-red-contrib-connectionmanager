function release(node,msg) {
	msg.cm.release.apply(node,[msg,
    	function() {node.send([msg]);},
    	function(e) {
           	node.error(e);
           	msg.error=e;
    		node.send([null,msg]);
    	}
    ]);
}

module.exports = function(RED) {
    function ReleaseConnectionNode(n) {
        RED.nodes.createNode(this,n);
        this.log("Copyright 2019 Jaroslav Peter Prib");
        var node=Object.assign(this,n);
        node.rollbackTransaction=(node.rollback=="yes");
        
        
        node.on('input', function (msg) {
        	if(msg.cm) {
        		if(msg.cm.autoCommit) {
        			release(node,msg);
        		} else if(node.rollbackTransaction) {
                	msg.cm.rollback.apply(node,[msg,
                		function() {release(node,msg);},
                		function(e) {node.warn("rollback failed "+e);release(node,msg);}  // ignore rollback errors
               		]);
            	} else {
                	msg.cm.commit.apply(node,[msg,
                		function() {release(node,msg);},
                		function(e) {node.warn("rollback failed "+e);release(node,msg);}  // ignore commit errors
               		]);
            	}
        	} else {
        		node.send([msg]);
        	}
        });
    }
    RED.nodes.registerType("Release Connections",ReleaseConnectionNode);
};