const ts=(new Date().toString()).split(' ');
console.log([parseInt(ts[2],10),ts[1],ts[4]].join(' ')+" - [info] release-connection Copyright 2019 Jaroslav Peter Prib");
module.exports = function(RED) {
    function ReleaseConnectionNode(n) {
        RED.nodes.createNode(this,n);
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
    					node.status({ fill: 'red', shape: 'ring', text: "Error check log" });

        	    	}
        	    ]);
        	} else {
            	node.send([msg]);
        	}
        });
    }
    RED.nodes.registerType("Release Connections",ReleaseConnectionNode);
};