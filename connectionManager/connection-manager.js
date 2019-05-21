var debug=false;
function connectionProcessorComplete(msg,done,error,results,errors) {
	if(debug) console.log("connectionProcessorComplete "+msg.cm.running);
	if(--msg.cm.running==0) {
		if(errors && error) {
			if(debug) console.log("connectionProcessorComplete  errors "+JSON.stringify(errors));
			error.apply(this,[results,errors]);
		} else {
			done.apply(this,[results,errors]);
		}
	}
}
function connectionProcessor(msg,action,done,error,statement,params) {
	if(debug) console.log("connectionProcessor ");
    msg.cm.running++;
	var c,results={},errors;
	for(var n in msg.cm.connection) {
		if(debug) console.log("connectionProcessor connection: "+n);
	    msg.cm.running++;
		c=msg.cm.connection[n];
		c.pool[action].apply(c.pool,[c,
			function(result) {
				results[n]=result;
				connectionProcessorComplete(msg,done,error,results,errors);
			},
			function(err) {
				if(debug) console.log("connectionProcessor connection: "+n+" error: "+err);
				if(errors==null) errors={};
				try{	
					c.pool.node.error("connection "+ n +" "+err);
					errors[n]=String(err);
				} catch(e) {
					console.log("connectionProcessor catch error: "+String(e));
				}
				connectionProcessorComplete(msg,done,error,results,errors);
			},
			statement,
			params
		]);
	}
	connectionProcessorComplete(msg,done,error,results,errors);
}
function cmProcessor(msg,action,done,error,statement,params) {
    if(!msg.cm) {done(); return;}
    var thisObject=this;
	stackProcessor.apply(this,[msg,action,
		function(){
			connectionProcessor.apply(thisObject,[msg,action,done,error,statement,params]);
		},
		error
	]);
}
function query(msg,connection,statement,params,done,error) {
	if(debug) console.log("query connection: "+connection+" statement: "+statement);
	if(!statement || statement.trim()=="") {
		error("empty query");
		return;
	}
	if(connection) {
		if(connection in msg.cm.connection) {
			var connector=msg.cm.connection[connection];
		} else {
			error("connection "+connection+" not established by previous node");
			return;
		}
		connector.pool.query(connector,   //c,sql,params,done,error
			done,
			(err)=>{
				if(debug) console.log("query error "+err);
				error(String(err));
			},
			node.statement,
			params
		);
		return;
	}		
	if(debug) console.log("query connection all connections");
	connectionProcessor.apply(this,[msg,"query",done,error,statement,params]);
}

function commit(msg,done,error) {
	cmProcessor.apply(this,[msg,"commit",done,error]);
}
function rollback(msg,done,error) {
	cmProcessor.apply(this,[msg,"rollback",done,error]);
}
function release(msg,done,error,rollback) {
	if(debug) console.log("release");
	if(msg.cm.autoCommit) {
		cmProcessor.apply(this,[msg,"release",done,error]);
		return;
	}
	var thisObject=this,   
		action=this.rollbackTransaction?"rollback":"commit";
	cmProcessor.apply(this,[msg,action,
		()=>{
			if(debug) console.log("release "+action+" all now releasing");
			cmProcessor.apply(thisObject,[msg,"release",done,error]);
		},
		(err)=> {
			if(debug) console.log("release "+action+" all with error now releasing "+JSON.stringify(err));
			cmProcessor.apply(thisObject,[msg,"release",
				error,
				(e1)=>{
					error(e+" and "+e1);
				}
			]);
		},
	]);
}
function stackProcessor(msg,action,done,error) {
	if(msg.cm.stack.length==0) {
		if(msg.cm.running==0) done();
		return;
	}
	var r=msg.cm.stack.pop();
	if(!(action in r)) {
		stackProcessor.apply(this,[msg,action,done,error]);
		return;
	}
	msg.cm.running++;
	stackProcessor.apply(this,[msg,action,done,error]);
	try{
		r[action].apply(r.node,[msg,
			function() {if(--msg.cm.running==0) done();}
		]);
	} catch(e) {
		r.node.error(action+" failed for node: "+r.node.id+" reason: "+e);
		if(--msg.cm.running==0) done();
	}
}
function ConnectionPool(node) {
	this.node=node;
	this.driverType=node.driver;
	this.size=Number(node.poolsize||10);
	this.active=[];
	this.free=[];
	this.pool=[];
	this.lastUsed=[];
	this.newConnections=0;
}
ConnectionPool.prototype.beginTransaction=function(c,done,error) {
	if(debug) console.log("ConnectionPool beginTransaction");
	this.driver.beginTransaction(c.connection,done,error);
}
ConnectionPool.prototype.close=function(c,done,error) {
	if(this.active.indexOf(c)>-1) {
		this.node.error("rolling back active connection as close issued");
		var thisObject=this;
		this.rollback.apply(this,[c,
			function() {thisObject.close(c,done,error);}
		]);
		this.returnConnection(c.id);
	} else{
		this.driver.close(c,done,error);
	}
};
ConnectionPool.prototype.commit=function(c,done,error) {
	this.driver.commit(c.connection,done,error);
};
ConnectionPool.prototype.closeAll=function(done) {
	this.node.log("closing all connections");
	var running=1;
	for(var c in this.pool) {
		running++;
		this.pool[n].close.apply(this.pool,[c,
			function(){if(--running) done();}
		]);
	}
	if(--running==0) done();
}
ConnectionPool.prototype.connection=function(c) {
	this.pool[c];
}
ConnectionPool.prototype.error=function(err,callback) {
	this.node.error(err);
	this.lastError=err;
	callback(err);
}
ConnectionPool.prototype.getConnection=function(done,error) {
	if(debug) console.log("ConnectionPool getConnection");
	if(this.drive==undefined) {
		if(debug) console.log("ConnectionPool getConnection set driver "+this.driverType);
		try{
			this.driver=DriverType[this.driverType];
			if(this.driver==null) throw Error("Driver returned null");
			this.autoCommit=this.driver.autoCommit;
		} catch(e) {
			var err="Driver load failed, may need install by 'npm install "+this.driverType+"', drivers aren't install by default to minimise foot print";
			this.node.error(err);
			error(err);
			return;
		}
	}
	var connectionPool=this;
	if(this.free.length) {
		if(debug) console.log("ConnectionPool getConnection free");
		var c=connectionPool.free.pop();
		connectionPool.active.push(c);
		done( {id:c, pool:connectionPool, connection:this.pool[c]} );
		return;
	}
	if(debug) console.log("ConnectionPool getConnection create new connection");
	if(++this.newConnections>this.size) {  // this.pool.length updated too late 
		connectionPool.error("maximum pool size "+this.size,error);
		return;
	}
	this.driver.getConnection(this.node,
		function (connection) {
			connectionPool.node.log("new connection "+connectionPool.node.name);
			var c=connectionPool.pool.push(connection)-1;
			connectionPool.lastUsed.push(new Date());
			connectionPool.active.push(c);
			done( {id:c, pool:connectionPool, connection:connection});
		},
		function(err){connectionPool.node.error(err); error(err);}
	);
}
ConnectionPool.prototype.getDetails=function() {
	return {connected:this.pool.length,active:this.active.length,free:this.free.length,lastError:this.lastError||'',autoCommit:this.autoCommit};
}
ConnectionPool.prototype.query=function(c,done,error,sql,params) {   
	if(debug) console.log("ConnectionPool query connection id: "+c.id+" sql: "+sql+" parms: "+JSON.stringify(params));
	this.lastUsed[c.id]=new Date();
	this.driver.query(c.connection,sql,params,done,
			(err)=>{
				if(debug) console.log("ConnectionPool query "+err);
				error(err)
			}
			);
};
ConnectionPool.prototype.release=function(c,done) {
	if(debug) console.log("ConnectionPool.release "+c.id);
	this.returnConnection(c.id);
	done();
};
ConnectionPool.prototype.returnConnection=function(c) {
	this.active.splice(this.active.indexOf(c),1);
	this.free.push(c);
};
ConnectionPool.prototype.rollback=function(c,done,error) {
	if(debug) console.log("ConnectionPool.rollback ");
	this.driver.rollback(c.connection,done,error);
} 

ConnectionPool.prototype.releaseStaleConnections=function() {
	try{
		var thisObject=this,
			staleTimestamp= new Date(Date.now() - (1 * 60 * 1000));
		for(var i in this.active) {
			if(this.lastUsed[i] < staleTimestamp) {
				this.node.error("Releasing long running connection with rollback "+i);
				this.driver.rollback.apply(this.driver,[
					thisObject.pool[i],
					()=>thisObject.release.apply(thisObject,[i,()=>{thisObject.node.log("Released connection with rollback "+i);}]),
					(err)=>thisObject.release.apply(thisObject,[i,()=>{thisObject.node.warn("Releasing connection "+i+" rollback failed: "+err);}])
					]);
			}
		}
	} catch(e) {
		console.error("releaseStaleConnections failed: "+e)
	}
}
module.exports = function(RED) {
    function ConnectionManagerNode(n) {
        RED.nodes.createNode(this,n);
        this.log("Copyright 2019 Jaroslav Peter Prib");
        var node=Object.assign(this,n,{port:Number(n.port)});
        node.connectionPool=new ConnectionPool(node);
        
        if (node.credentials) {
        	node.user = node.credentials.user;
        	node.password = node.credentials.password;
        }
        node.setMsg= function(msg,done,error) {
        	if(!msg.cm) {
        		var cm={running:0,connection:{},stack:[]
        			,commit:commit,rollback:rollback,release:release
        			,query:query
        			};
            	RED.util.setMessageProperty(msg,"cm",cm);
        	}
        	cm.autoCommit=(node.autoCommit=="yes");
        	node.connectionPool.getConnection(	//getConnectionTransactional
        		function (connection) {
                    msg.cm.connection[node.name]=connection;
        			if(msg.cm.autoCommit==null){
        				msg.cm.autoCommit=connection.pool.autoCommit;
        			} else {
        				if(msg.cm.autoCommit!==connection.pool.autoCommit) {
        					node.connectionPool.beginTransaction(connection,done,(err)=>{
        						error("error with begin transaction "+err);
        						node.connectionPool.release(connection,()=>{},()=>{});
        					});
//        					error("mixed mode on autocommit between connections, message has "+msg.cm.autoCommit+" connection pool "+connection.pool.autoCommit);
        					return;
        				}
        			}
                    done();
        		},
        		error
        	);
        };
       	node.on("close", function(removed,done) {
            clearInterval(node.releaseStaleConnections); 
       		node.connectionPool.close(done);
       	});
       	node.releaseStaleConnections = setInterval(function(node) {node.connectionPool.releaseStaleConnections.apply(node.connectionPool)}, 1000*60,node);
   }
   RED.nodes.registerType("Connection Manager",ConnectionManagerNode,
    	{credentials: {
            user: {type: "text"},
            password: {type: "password"}
        }});
};

function Driver(a) {
	this.testOnConnect="select 'connect dummy test'";
	if(!a.optionsMapping) {
		this.optionsMapping ={
			host     : "host", 
			port     : "port", 
			database : "dbname", 
			user     : "user", 
			password : "password"
		};
	}
	this.autoCommit=false;
	Object.assign(this,a);
	this.getConnection=this.q?this.getConnectionQ:this.getConnectionC;
	this.query=this.q?this.queryQ:this.queryC;
}
Driver.prototype.beginTransaction=function(conn,done,error) {
	if(debug) console.log("Driver.beginTransaction");
	this.query(conn,"Start Transaction",null,done,error);
};
Driver.prototype.close=function(conn,done,error) {
	if(debug) console.log("close");
	conn.close().then(done).fail(function(err, result) {
		if(error) {
			error(err);
			return;
		}
		done([{sql:sql,error:err}]);
	});
};
Driver.prototype.commit=function(conn,done,error) {
	if(debug) console.log("Driver.commit");
	this.query(conn,"commit",null,done,error);
};
Driver.prototype.getOptions=function(node) {
	if(debug) console.log("Driver.getOptions "+JSON.stringify(this.optionsMapping));
	if(!this.options) {
		this.options=Object.assign({},this.optionsMapping);
		for(var i in this.optionsMapping ) {
			try{
				if(debug) console.log("Driver.getOptions propery "+i+" set to configuration property "+this.optionsMapping[i]);
				this.options[i]=node[this.optionsMapping[i]];
				if(this.options[i]==null) throw Error("not set but expected");
			} catch(e) {
				node.error("option "+i+" set to configuration property "+this.options[i]+" has problem "+e)
			}
		}
	}
	return this.options;
};
Driver.prototype.getConnectionC=function(node,done,error) {
	try{
		var options=this.getOptions(node);
		if(debug) console.log("getConnectionC "+JSON.stringify(Object.assign({},options,{password:"***masked"})));
		if(debug) console.log("getConnectionC "+JSON.stringify(Object.assign({},options)));
		var thisObject=this;
		var c = new (this.Driver())(options);
		c.connect( function(err) {
			if(err) {
				if(debug) console.log("getConnection error "+err);
				error(err);
				return;
			}
			if(thisObject.testOnConnect) {
				thisObject.query(c,thisObject.testOnConnect,null,function() {
						done(c);
					},
					error
				);
			} else {
				done(c);
			}
		});
	} catch(e) {
		if(error) error(e);
	}
};
Driver.prototype.getConnectionQ=function(node,done,error) {
	try{
		var options=this.getOptions(node);
		if(debug) console.log("getConnectionQ "+JSON.stringify(Object.assign({},options,{password:"***masked"})));
		var c = new this.Driver(options);
		var thisObject=this;
		c.connect(options).then(function(){
			if(thisObject.testOnConnect) {
				thisObject.query(c,thisObject.testOnConnect,null,function() {
						done(c);
					},
					error
				);
			} else {
				done(c);
			}
		}).fail(function(err) {
			if(debug) console.log("query error "+err);
			error(err);
		});
	} catch(e) {
		if(error) error(e);
	}
};
Driver.prototype.queryC=function(conn,sql,params,done,error) {
	if(debug) console.log("Driver.queryC "+JSON.stringify({sql:sql,params:params}));
	var thisObject=this;
	try{
		conn.query(sql,params,(err, result) => {
			if(err) {
				if(debug) console.log("Driver.queryC error: "+err);
				error(err);
			} else {
				if(debug) console.log("Driver.queryC first 100 chars results"+JSON.stringify(result||"<null>").substring(1,100));
				done(result);
			}
		});
	} catch(e) {
		error(e);
	}
},
Driver.prototype.queryQ=function(conn,sql,params,done,error) {
	if(debug) console.log("Driver.queryQ "+JSON.stringify({sql:sql,params:params}));
	var thisObject=this;
	try{
		conn.query(sql,params).then(function(result){
			if(debug) console.log("Driver.queryQ first 100 chars results"+JSON.stringify(result||"<null>").substring(1,100));
			done(result);
		}).fail(function(err){
			if(debug) console.log("Driver.queryQ fail: "+err);
			error(err);
		});
	} catch(e) {
		if(debug) console.log("Driver.queryQ error: "+e);
		error(e);
	}
},
Driver.prototype.rollback=function(conn,done,error) {
	if(debug) console.log("Driver.rollback");
	this.query(conn,"rollback",null,done,error);
};
var DriverType = {
		'monetdb': new Driver({
			Driver:require('monetdb')({maxReconnects:0,debug:false}),
			autoCommit:true,
			q:true,
			optionsMapping: {
				host     : "host", 
				port     : "port", 
				dbname   : "dbname", 
				user     : "user", 
				password : "password"
			}
		}),
		'pg': new Driver({
			Driver: function() {
				return require('pg').Client;
			},
			autoCommit:true
		})
	};


