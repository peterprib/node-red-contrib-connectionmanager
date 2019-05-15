var debug=true;
function connectionProcessor(msg,action,done,error,statement) {
    msg.cm.running++;
	var c,results={},errors;
	for(var n in msg.cm.connection) {
	    msg.cm.running++;
		c=msg.cm.connection[n];
		c.pool[action].apply(c.pool,[c,
			function(result) {
				results[n]=result;
				if(--msg.cm.running==0) {
					if(errors && error) {
						error.apply(this,[results,errors]);
					} else {
						done.apply(this,[results,errors]);
					}
				}
			},
			function(e) {
				if(errors==null) errors={};
				try{	
					c.pool.node.error("connection "+ n +" "+e);
					errors[n]=e;
				} catch(e2) {
					console.log("connectionProcessor catch error: "+e2);
				}
				if(--msg.cm.running==0) {
					if(errors && error) {
						error.apply(this,[results,errors]);
					} else {
						done.apply(this,[results,errors]);
					}
				}
			},
			statement,
			msg.cm.params||msg.payload
		]);
	}
	if(--msg.cm.running==0) {
		if(errors && error) {
			error.apply(this,[results,errors]);
		} else {
			done.apply(this,[results,errors]);
		}
	}
}
function cmProcessor(msg,action,done,error) {
    if(!msg.cm) {done(); return;}
    var thisObject=this;
	stackProcessor.apply(this,[msg,action,
		function(){
			connectionProcessor.apply(thisObject,[msg,action,done,error]);
		},
		error
	]);
}
function query(msg,connection,statement,done,error) {
	if(debug) console.log("query connection: "+connection+" statement: "+statement);
	if(connection) {
		if(connection in msg.cm.connection) {
			var connector=msg.cm.connection[connection];
		} else {
			error("connection "+connection+" not established by previous node");
			return;
		}
		connector.pool.query(connector,   //c,sql,params,done,error
			function (result) {done(result);},
			function(err) {error(err);},
			node.statement,
			msg.cm.params||msg.payload
		);
		return;
	}		
	if(debug) console.log("query connection all connections");
	
	connectionProcessor.apply(this,[msg,"query",done,error,statement]);
}

function commit(msg,done,error) {
	cmProcessor.apply(this,[msg,"commit",done,error]);
}
function rollback(msg,done,error) {
	cmProcessor.apply(this,[msg,"rollback",done,error]);
}
function release(msg,done,error) {
	if(msg.cm.autoCommit) {
		cmProcessor.apply(this,[msg,"release",done,error]);
		return;
	}
	var thisObject=this;
	cmProcessor.apply(this,[msg,"commit",
		function() {
			cmProcessor.apply(thisObject,[msg,"release",done,error]);
		},
		function(e) {
			cmProcessor.apply(thisObject,[msg,"release",
				error,
				function(e1) {
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
ConnectionPool.prototype.release=function(c,done) {
	this.returnConnection(c.id);
	done();
};
ConnectionPool.prototype.returnConnection=function(c) {
	this.active.splice(this.active.indexOf(c),1);
	this.free.push(c);
};
ConnectionPool.prototype.commit=function(c,done,error) {
	this.driver.commit(c.connection,done,error);
};
ConnectionPool.prototype.rollback=function(c,done,error) {
	this.driver.rollback(c.connection,done,error);
} 
ConnectionPool.prototype.query=function(c,done,error,sql,params) {   
	if(debug) console.log("ConnectionPool query connection id: "+c.id+" sql: "+sql+" parms: "+JSON.stringify(params));
	this.lastUsed[c.id]=new Date();
	this.driver.query(c.connection,sql,params,done,error);
};
ConnectionPool.prototype.getDetails=function() {
	return {connected:this.pool.length,active:this.active.length,free:this.free.length,lastError:this.lastError||'',autoCommit:this.autoCommit};
}
ConnectionPool.prototype.error=function(error,callback) {
	this.node.error(error);
	this.lastError=error;
	callback(error);
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
		function(e){connectionPool.node.error(e); error(e);}
	);
}
ConnectionPool.prototype.connection=function(c) {
	this.pool[c];
}
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
ConnectionPool.prototype.releaseStaleConnections=function() {
	var staleTimestamp= new Date(Date.now() - (1 * 60 * 1000));
	for(var i in this.active) {
		if(this.lastUsed[i] < staleTimestamp) {
			this.node.Error("Releasing long running connection "+i);
			this.release(i,function() {});
		}
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
        		msg.cm={running:0,connection:{},stack:[]
        			,commit:commit,rollback:rollback,release:release
        			,query:query
        			};
        	}
        	node.connectionPool.getConnection(
        		function (connection) {
                    msg.cm.connection[node.name]=connection;
        			if(msg.cm.autoCommit==null){
        				msg.cm.autoCommit=connection.pool.autoCommit;
        			} else {
        				if(msg.cm.autoCommit!==connection.pool.autoCommit) {
        					error("mixed mode on autocommit between connections");
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

Driver.prototype.commit=function(conn,done,error) {
	if(debug) console.log("Driver.commit");
	this.query(conn,"commit",null,
		done,
		function(e) {
			error(e);
		}
	);
};
Driver.prototype.rollback=function(conn,done,error) {
	if(debug) console.log("Driver.rollback");
	this.query(conn,"rollback",null,done,error);
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
Driver.prototype.queryQ=function(conn,sql,params,done,error) {
	if(debug) console.log("Driver.queryQ "+JSON.stringify({sql:sql,params:params}));
	if(!sql || sql.trim()=="") {
		if(error) {
			error("empty query");
		} else {
			console.log("Driver, no error defaulting to done, error: empty query");
			done([{sql:sql,error:"empty query"}]);
		}
		return;
	}
	var thisObject=this;
	try{
		conn.query(sql,params).then(function(result){
			if(debug) console.log("Driver.queryQ first 100 chars results"+JSON.stringify(result||"<null>").substring(1,100));
			done(result);
		}).fail(function(err){
			if(debug) console.log("Driver.queryQ error: "+err);
			if(error) {
				error(err);
				return;
			}
			console.log("Driver, no error defaulting to done, error: "+e);
			done([{sql:sql,error:err}]);
		});
	} catch(e) {
		if(debug) console.log("Driver.queryQ error: "+err);
		if(error) {
			error(err);
			return;
		}
		console.log("Driver, no error defaulting to done, error: "+e);
		done([{sql:sql,error:err}]);
	}
},
Driver.prototype.queryC=function(conn,sql,params,done,error) {
	if(debug) console.log("Driver.queryC "+JSON.stringify({sql:sql,params:params}));
	if(!sql || sql.trim()=="") {
		if(error) {
			error("empty query");
		} else {
			console.log("Driver, no error defaulting to done, error: empty query");
			done([{sql:sql,error:"empty query"}]);
		}
		return;
	}
	var thisObject=this;
	try{
		conn.query(sql,params,(err, result) => {
			if(err) {
				if(debug) console.log("Driver.querycC error: "+err);
				if(error) {
					error(err);
					return;
				}
				console.log("Driver, no error defaulting to done, error: "+e);
				done([{sql:sql,error:err}]);
			} else {
				if(debug) console.log("Driver.queryC first 100 chars results"+JSON.stringify(result||"<null>").substring(1,100));
				done(result);
			}
		});
	} catch(e) {
		if(error) {
			error(err);
			return;
		}
		console.log("Driver, no error defaulting to done, error: "+e);
		done([{sql:sql,error:err}]);
	}
},
Driver.prototype.close=function(conn,done,error) {
	if(debug) console.log("close");
	conn.close().then(done).fail(function(err, result) {
		if(error) {
			error(err);
			return;
		}
		done([{sql:sql,error:err}]);
	});
}
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


