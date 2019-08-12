const ts=(new Date().toString()).split(' ');
console.log([parseInt(ts[2],10),ts[1],ts[4]].join(' ')+" - [info] connection-manager Copyright 2019 Jaroslav Peter Prib");
var debug=false;
function toggleDebug() {
	debug=!debug;
	console.log("connection-manager toggleDebug state: " +debug);
}
var Pools={};
function getPool(id) {
	return Pools[id];
}
function getMessageString(err) {
	return typeof(err)==='string'?err:err.message;
}
function connectionProcessorComplete(msg,done,error,results,errors) {
	if(debug) console.log("connectionProcessorComplete "+msg.cm.running);
	if(--msg.cm.running==0) {
		if(errors) {
			if(debug) console.log("connectionProcessorComplete errors "+JSON.stringify(errors));
			error.apply(this,[results,errors]);
		} else {
			done.apply(this,[results]);
		}
	}
}
function connectionProcessor(msg,action,done,error,a1,a2) {
	if(debug) console.log("connectionProcessor action: "+action+" arguments "+JSON.stringify({a1:a1,a2:a2}));
    msg.cm.running++;
	var c,results={},errors,pool;
	for(var connection in msg.cm.connection) {
		if(debug) console.log("connectionProcessor connection: "+connection);
	    msg.cm.running++;
		c=msg.cm.connection[connection];
		pool=getPool(c.pool);
		pool[action].apply(pool,[c,
			(result)=>{
				results[connection]=result;
				connectionProcessorComplete(msg,done,error,results,errors);
			},
			(err)=>{
				if(debug) console.log("connectionProcessor connection: "+connection+" error: "+err);
				errors=errors||{};
				try{
					errors[connection]=getMessageString(err);
				} catch(e) {
					console.error("connectionProcessor catch error: "+e);
				}
				connectionProcessorComplete(msg,done,error,results,errors);
			},
			a1,
			a2
		]);
	}
	connectionProcessorComplete(msg,done,error,results,errors);
}
function cmProcessor(msg,action,done,error,a1,a2) {
	if(debug) console.log("cmProcessor action: "+action);
    if(!msg.cm) {done(); return;}
    var thisObject=this;
	stackProcessor.apply(this,[msg,action,
		()=>connectionProcessor.apply(thisObject,[msg,action,done,error,a1,a2]),
		()=>connectionProcessor.apply(thisObject,[msg,action,done,error,a1,a2])
	]);
}
function query(msg,connection,statement,params,done,error) {
	if(debug) console.log("query connection: "+connection+" prepare: "+this.prepareSQL+" statement: "+statement);
	if(!statement || statement.trim()=="") {
		error({},"empty query");
		return;
	}
	if(connection) {
		if(connection in msg.cm.connection) {
			var connector=msg.cm.connection[connection];
		} else {
			error({},"connection "+connection+" not established by previous node");
			return;
		}
		var pool=getPool(connector.pool);
		
		if(debug) console.log("query connection: "+connection+" prepare: "+this.prepareSQL+" preparable: "+pool.preparable);
		if(this.prepareSQL && pool.preparable) {
			var node=this;
			pool.prepare(connector, 
				(prepared)=>pool.exec(prepared,done,error,params),
				(err)=>{
					if(debug) console.log("query prepare error "+err);
					error({},err);
				},
				statement,
				node.id
			);
			return;
		}
		pool.query(connector,   //c,sql,params,done,error
			done,
			(err)=>{
				if(debug) console.log("query error "+JSON.stringify(err));
				error({},err);
			},
			statement,
			params
		);
		return;
	}		
	if(debug) console.log("query connection all connections");
	if(this.prepareSQL) {
		var node=this;
		connectionProcessor.apply(node,[msg,"prepare",
			(prepared)=>{
				if(debug) console.log("query prepare exec node: "+node.id+" params: "+JSON.stringify(params));
				connectionProcessor.apply(node,[msg,"exec",done,error,node.id,params]);
			},
			(result,err)=>{
				if(debug) console.log("query prepare error(s) "+JSON.stringify(err));
				error(result,err);
			},
			statement,
			node.id
		]);
	} else {
		connectionProcessor.apply(this,[msg,"query",done,error,statement,params]);
	}
}

function commit(msg,done,error) {
	cmProcessor.apply(this,[msg,"commit",done,error]);
}
function rollback(msg,done,error) {
	cmProcessor.apply(this,[msg,"rollback",done,error]);
}
function release(msg,done,error) {
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
				(result)=>error(result,err),
				(result,e1)=>error(result,err+" and "+e1)
			]);
		},
	]);
}
function stackProcessor(msg,action,done,error) {
	if(debug) console.log("stackProcessor action: "+action);
	if(msg.cm.stack.length==0) {
		if(msg.cm.running==0) done();
		return;
	}
	var r=msg.cm.stack.pop();
	if(!r.hasOwnProperty('action')) {
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
	this.prepared=[]; //  {id:id}
}
ConnectionPool.prototype.beginTransaction=function(c,done,error) {
	if(debug) console.log("ConnectionPool beginTransaction");
	this.driver.beginTransaction(this.pool[c.id],done,error);
}
ConnectionPool.prototype.checkDeadConnection=function(c,errorMessage) {
	if(debug) console.log("ConnectionPool.checkDeadConnection");
	var msg=getMessageString(errorMessage);
	if(this.driver.errorDeadConnection) {
		if(this.driver.errorDeadConnection.includes(msg)) {
			if(debug) console.log("ConnectionPool.isDeadConnection set connection null and releasing");
			this.pool[c.id]=null;  // on release this deletes connection so not used again
			this.release(c);
		}
	}
};
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
ConnectionPool.prototype.commit=function(c,done,error) {
	var pool=this;
	this.driver.commit(this.pool[c.id],done,(err)=>{
		if(debug) console.log("ConnectionPool commit "+err);
		pool.checkDeadConnection(c,err);
		error(err)
	});
};
ConnectionPool.prototype.connection=function(c) {
	this.pool[c];
}
ConnectionPool.prototype.error=function(err,callback) {
	this.lastError=err;
	callback(err);
}
ConnectionPool.prototype.exec=function(c,done,error,id,params) {   
	if(debug) console.log("ConnectionPool exec connection id: "+c.id+" prepared id: "+id+" params: "+JSON.stringify(params));
	if(!this.preparable) {
		this.query(c,done,error,this.prepared[c.id][id],params);
		return;
	}
	this.lastUsed[c.id]=new Date();
	var pool=this;
	this.driver.exec(this.prepared[c.id][id],params,done,(err)=>{
		if(debug) console.log("ConnectionPool exec "+err);
		pool.checkDeadConnection(c,err);
		error(err)
	});
};
ConnectionPool.prototype.getConnection=function(done,error) {
	if(debug) console.log("ConnectionPool getConnection");
	if(this.drive==undefined) {
		if(debug) console.log("ConnectionPool getConnection set driver "+this.driverType);
		try{
			this.driver=DriverType[this.driverType];
			if(this.driver==null) throw Error("Driver returned null");
			this.autoCommit=this.driver.autoCommit||true;
			this.preparable=!(this.driver.prepareIsQuery||false);
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
		done( {id:c, pool:connectionPool.node.name} );
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
			var c = connectionPool.pool.find((e)=>e==null);
			if(c) {
				connectionPool.pool[c]=connection;
				connectionPool.node.log("reuse connection stale connect for "+connectionPool.node.name);
			} else {
				c=connectionPool.pool.push(connection)-1;
			}
			connectionPool.lastUsed.push(new Date());
			connectionPool.active.push(c);
			done( {id:c, pool:connectionPool.node.name});
		},
		function(err){connectionPool.node.error(err); error(err);}
	);
}
ConnectionPool.prototype.getDetails=function() {
	return {connected:this.pool.length,active:this.active.length,free:this.free.length,lastError:this.lastError||'',autoCommit:this.autoCommit};
}
ConnectionPool.prototype.prepare=function(c,done,error,sql,id) {   
	if(debug) console.log("ConnectionPool prepare connection id: "+c.id+" prepare id: "+id+" sql: "+sql);
	if(this.prepared[c.id]) {
		if(debug) console.log("ConnectionPool prepare already done");
		if(this.prepared[c.id][id]) {
			done(this.prepared[c.id][id]);
			return;
		}
	} else {
		this.prepared[c.id]={};
	}
	this.lastUsed[c.id]=new Date();
	if(!this.preparable) {
		if(debug) console.log("ConnectionPool prepare not available, simulating prepare");
		this.prepared[c.id][id]=(this.driver.translateSQL?this.driver.translateSQL(sql):sql);
		done(sql);
		return;
	}
	var pool=this;
	this.driver.prepare(this.pool[c.id],(this.driver.translateSQL?this.driver.translateSQL(sql):sql),
		(prepared)=>{
			pool.prepared[c.id][id]=prepared;
			if(debug) console.log("ConnectionPool prepared calling done");
			done(prepared);
		}, 
		(err)=>{
			if(debug) console.log("ConnectionPool prepare "+err);
			error(err)
	});
};
ConnectionPool.prototype.query=function(c,done,error,sql,params) {   
	if(debug) console.log("ConnectionPool query connection id: "+c.id+" sql: "+sql+" parms: "+JSON.stringify(params));
	this.lastUsed[c.id]=new Date();
	var pool=this;
	this.driver.query(this.pool[c.id],(this.driver.translateSQL?this.driver.translateSQL(sql):sql),params,done, (err)=>{
		if(debug) console.log("ConnectionPool query "+err);
		pool.checkDeadConnection(c,err);
		error(err);
	});
};
ConnectionPool.prototype.release=function(c,done) {
	if(debug) console.log("ConnectionPool.release "+c.id);
	this.returnConnection(c.id);
	if(done) done();
};
ConnectionPool.prototype.returnConnection=function(c) {
	if(debug) console.log("ConnectionPool.returnConnection "+c);
	this.active.splice(this.active.indexOf(c),1);
	if(this.pool[c]==null) {
		if(debug) console.log("ConnectionPool.returnConnection "+c+" is bad, not placed on free chain");
		return;
	}
	this.free.push(c);
};
ConnectionPool.prototype.rollback=function(c,done,error) {
	if(debug) console.log("ConnectionPool.rollback ");
	var pool=this;
	this.driver.rollback(this.pool[c.id],done,(err)=>{
		if(debug) console.log("ConnectionPool rollback "+err);
		pool.checkDeadConnection(c,err);
		error(err)
	});
} 
ConnectionPool.prototype.releaseStaleConnections=function() {
	try{
		var thisObject=this,
			staleTimestamp= new Date(Date.now() - (1 * 60 * 1000));
		for(var connectionID in this.active) {
			if(this.lastUsed[connectionID] < staleTimestamp) {
				this.node.error("Releasing long running connection with rollback "+connectionID);
				this.driver.rollback.apply(this.driver,[
					thisObject.pool[connectionID],
					()=>thisObject.release.apply(thisObject,[{id:connectionID},()=>{thisObject.node.log("Released connection with rollback "+connectionID);}]),
					(err)=>thisObject.release.apply(thisObject,[{id:connectionID},()=>{thisObject.node.warn("Releasing connection "+connectionID+" rollback failed: "+err);}])
					]);
			}
		}
	} catch(e) {
		console.error("releaseStaleConnections failed: "+e)
	}
}
ConnectionPool.prototype.releaseFreeConnections=function() {
	this.node.log("closing "+this.free.length+" free connections");
	let running=1,n,thisObject=this;
	for(let i=0;i<this.free.length;i++) {
		running++;
		n=this.free[i];
		this.pool[n].close.apply(this.pool,[n,
			function(){if(--running) thisObject.node.log("closed free connections");},
			function(err){
				thisObject.node.error(err);
				if(--running) thisObject.node.log("closed free connections");
			}
		]);
	}
	if(--running==0) this.node.log("closed free connections");
;
}

module.exports = function(RED) {
    function ConnectionManagerNode(n) {
        RED.nodes.createNode(this,n);
        var node=Object.assign(this,n,{port:Number(n.port)});
        node.connectionPool=new ConnectionPool(node);
        node.toggleDebug=toggleDebug;
        Pools[node.name]=node.connectionPool;

        node.setMsg= function(msg,done,error) {
        	if(!msg.cm) {
        		var cm={id:node.id,running:0,connection:{},stack:[]
        			,commit:commit,rollback:rollback,release:release
        			,query:query
        			};
            	RED.util.setMessageProperty(msg,"cm",cm);
            	cm.autoCommit=(node.autoCommit=="yes");
        	}
        	node.connectionPool.getConnection(	//getConnectionTransactional
        		(connection)=>{
                    msg.cm.connection[node.name]=connection;
        			if(msg.cm.autoCommit==null){
        				msg.cm.autoCommit=connection.pool.autoCommit;
        			} else {
        				if(msg.cm.autoCommit!==connection.pool.autoCommit) {
        					node.connectionPool.beginTransaction(connection,done,(err)=>{
        						error("error with begin transaction "+err);
        						node.connectionPool.release(connection,()=>{},()=>{});
        					});
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
   RED.nodes.registerType("Connection Manager",ConnectionManagerNode,{
	   credentials: {
            user: {type: "text"},
            password: {type: "password"}
       }
   });
};

function Driver(a) {
	if(!a.optionsMapping) {
		this.optionsMapping ={
			host     : "host", 
			port     : "port", 
			database : "dbname", 
			user     : "user", 
			password : "password"
		};
	}
	Object.assign(this,{
			autoCommit:false,
			connectPhrase:"connect",
			testOnConnect:"select 'connect dummy test'",
			getConnection: this.getConnectionC,
			paramNull:null,
			query:this.queryC,
			prepare:this.prepareC,
			exec:this.execC,
			beginTransaction:this.beginTransactionSql,
			commit:this.commitSql
		},
		a
	);
}
Driver.prototype.beginTransactionNoAction=function(conn,done,error) {
	if(debug) console.log("Driver.beginTransactionNoAction");
	done();
}
Driver.prototype.beginTransactionSql=function(conn,done,error) {
	if(debug) console.log("Driver.beginTransactionSql");
	this.query(conn,"Start Transaction",null,done,error);
};
Driver.prototype.close=function(conn,done,error) {
	if(debug) console.log("close");
	conn.close().then(done,(err,result)=>{
		if(error) {
			error(err);
			return;
		}
		done([{sql:sql,error:err}]);
	});
};
Driver.prototype.commitNoAction=function(conn,done,error) {
	if(debug) console.log("Driver.commitNoAction");
	done();
};
Driver.prototype.commitSql=function(conn,done,error) {
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
				if(node.credentials && node.credentials.hasOwnProperty(this.optionsMapping[i])) {
					this.options[i]=node.credentials[this.optionsMapping[i]];
				} else {
					this.options[i]=node[this.optionsMapping[i]];
				}
				if(this.options[i]==null) {
					throw Error("not set but expected");
				}
			} catch(e) {
				node.error("option "+i+" set to configuration property "+this.optionsMapping[i]+" has problem "+e)
			}
		}
	}
	return this.options;
};
Driver.prototype.getConnectionC=function(node,done,error) {
	try{
		var options=this.getOptions(node);
		if(debug) console.log("getConnectionC "+JSON.stringify(Object.assign({},options,{password:"***masked"})));
		var thisObject=this;
		var c = new (this.Driver())(options);
		c.connect((err)=>{
			if(err) {
				if(debug) console.log("getConnection error "+err);
				error(err);
				return;
			}
			if(thisObject.testOnConnect) {
				thisObject.query(c,thisObject.testOnConnect,null,()=>done(c),error);
			} else {
				done(c);
			}
		});
	} catch(e) {
		console.error("Driver.getConnectionC error: "+e);
		error(e);
	}
};
Driver.prototype.getConnectionO=function(node,done,error) {
	try{
		var options=this.getOptions(node);
		if(debug) console.log("getConnectionC "+JSON.stringify(Object.assign({},options,{password:"***masked"})));
		if(!this.driverInstance) this.driverInstance= new (this.Driver());
		let thisObject=this,
			connectString="DATABASE="+options.database+";HOSTNAME="+options.host+";UID="+options.user+";PWD="+options.password+";PORT="+options.port+";PROTOCOL=TCPIP";
		this.driverInstance.open(connectString,(err,conn)=>{
			if(err) {
				if(debug) console.log("getConnection error "+err);
				error(err);
				return;
			}
			if(thisObject.testOnConnect) {
				thisObject.query(conn,thisObject.testOnConnect,null,()=>done(conn),error);
			} else {
				done(conn);
			}
		});
	} catch(e) {
		console.error("Driver.getConnectionC error: "+e);
		error(e);
	}
};
Driver.prototype.getConnectionNeo4j=function(node,done,error) {
	try{
		let options=this.getOptions(node);
		if(debug) console.log("getConnectionNeo4j "+JSON.stringify(Object.assign({},options)));
		let neo4j=new this.Driver(),
			driver=neo4j.driver("bolt://"+options.host+":"+options.host, neo4j.auth.basic(options.user,options.password));
		if(!driver) throw Error("driver build failed");
		var session=driver.session();
		if(this.testOnConnect) {
			this.query(session,this.testOnConnect,null,()=>done(session),error);
		} else {
			done(session);
		}
	} catch(e) {
		console.error("Driver.getConnectionNeo4j error: "+e);
		error(e);
	}
};
Driver.prototype.getConnectionQ=function(node,done,error) {
	try{
		let options=this.getOptions(node);
		if(debug) console.log("getConnectionQ "+JSON.stringify(Object.assign({},options,{password:"***masked"})));
		let c = new this.Driver(options),
			thisObject=this;
		c.connect(options).then(
			()=>{
				if(thisObject.testOnConnect) {
					thisObject.query(c,thisObject.testOnConnect,null,()=>done(c),error);
				} else {
					done(c);
				}
			},
			(err)=>{
				if(debug) console.log("query error "+err);
				error(err);
			}
		);
	} catch(e) {
		console.error("Driver.getConnectionQ error: "+e);
		error(e);
	}
};
Driver.prototype.execQ=function(preparedSql,params,done,error) {
	if(debug) console.log("Driver.execQ "+JSON.stringify({params:params}));
	var thisObject=this;
	try{
		preparedSql.exec(params||this.paramNull).then(
			(result)=>{
				if(debug) console.log("Driver.execQ first 100 chars results"+JSON.stringify(result||"<null>").substring(1,100));
				done(result);
			},
			(err)=>{
				if(debug) console.log("Driver.execQ fail: "+err);
				try{
					error(err);
				} catch(e) {
					console.error("Driver.execQ fail error: "+e+" stack:\n"+e.stack);
				}
			}
		);
	} catch(e) {
		console.error("Driver.execQ error: "+e);
		error(e);
	}
},
Driver.prototype.prepareQ=function(conn,sql,done,error) {
	if(debug) console.log("Driver.prepareQ "+JSON.stringify({sql:sql}));
	var thisObject=this;
	try{
		conn.prepare(sql).then(
			(prepResult)=>{
				if(debug) console.log("Driver.prepareQ prepared completed");
				done(prepResult);
			},
			(err)=>{
				if(debug) console.log("Driver.prepareQ fail: "+err);
				error(err);
			}
		);
	} catch(e) {
		console.error("Driver.prepareQ error: "+e);
		error(e);
	}
},
Driver.prototype.queryC=function(conn,sql,params,done,error) {
	if(debug) console.log("Driver.queryC "+JSON.stringify({sql:sql,params:params}));
	var thisObject=this;
	try{
		conn.query(sql,(params||this.paramNull),(err, result) => {
			if(err) {
				if(debug) console.log("Driver.queryC error: "+err);
				error(err);
			} else {
				if(debug) console.log("Driver.queryC first 100 chars results"+JSON.stringify(result||"<null>").substring(1,100));
				done(result);
			}
		});
	} catch(e) {
		console.error("Driver.queryC error: "+e);
		error(e);
	}
},
Driver.prototype.queryNeo4j=function(session,cmd,params,done,error) {
	if(debug) console.log("Driver.queryNeo4j "+JSON.stringify({cmd:cmd,params:params}));
	try{
		session.run(cmd,(params||this.paramNull)).then(done).catch(error);
	} catch(e) {
		console.error("Driver.queryNeo4j error: "+e);
		error(e);
	}
},
Driver.prototype.queryQ=function(conn,sql,params,done,error) {
	if(debug) console.log("Driver.queryQ "+JSON.stringify({sql:sql,params:params}));
	var thisObject=this;
	try{
		conn.query(sql,(params||this.paramNull)).then(
			(result)=>{
				if(debug) console.log("Driver.queryQ first 100 chars results"+JSON.stringify(result||"<null>").substring(1,100));
				done(result);
			},
			(err)=>{
				if(debug) console.log("Driver.queryQ fail: "+err);
				try{
					error(err);
				} catch(e) {
					console.error("Driver.queryQ fail error: "+e+" stack:\n"+e.stack);
				}
			}
		);
	} catch(e) {
		console.error("Driver.queryQ error: "+e);
		error(e);
	}
},
Driver.prototype.rollback=function(conn,done,error) {
	if(debug) console.log("Driver.rollback");
	this.query(conn,"rollback",null,done,error);
};
Driver.prototype.translateSQL=function(sql) {
	return sql;
};
var DriverType = {
		'db2': new Driver({
			Driver: function() {
				return require('ibm_db');
			},
			getConnection: Driver.prototype.getConnectionO
		}),
		'monetdb': new Driver({
			Driver:require('monetdb')({maxReconnects:0,debug:false}),
			autoCommit:true,
			getConnection: Driver.prototype.getConnectionQ,
			paramNull: [],
			query:Driver.prototype.queryQ,
			prepare:Driver.prototype.prepareQ,
			exec:Driver.prototype.execQ,
			optionsMapping: {
				host     : "host", 
				port     : "port", 
				dbname   : "dbname", 
				user     : "user", 
				password : "password"
			},
			prepareIsQuery:false,
			errorDeadConnection: [
				"Cannot accept request: connection was destroyed.",
				"Failed to connect to MonetDB server"
			]
		}),
		'neo4j': new Driver({
			Driver: function() {
				return require('neo4j-driver').v1;
			},
			autoCommit:false,
			beginTransaction:Driver.prototype.beginTransactionNoAction,
			commit:Driver.prototype.commitNoAction,
			prepareIsQuery:true,
			testOnConnect:null,
			getConnection: Driver.prototype.getConnectionNeo4j,
			query:Driver.prototype.queryNeo4j
		}),	
		'pg': new Driver({
			Driver: function() {
				return require('pg').Client;
			},
			autoCommit:true,
			prepareIsQuery:true,
			translateSQL:function(sql) {
				var r="";
				sql.split('?').forEach((e,i)=>r+=e+"$"+(i+1));
				return r.slice(0, -2);
			}
		})
	};
