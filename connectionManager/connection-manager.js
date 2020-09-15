const logger = new (require("node-red-contrib-logger"))("Connection Manager");
logger.sendInfo("Copyright 2020 Jaroslav Peter Prib");
function toggleDebug() {
	logger.setOn();
}
let Pools={};
function getPool(id) {
	return Pools[id];
}
function getMessageString(err) {
	return typeof(err)==='string'?err:err.message;
}
function connectionProcessorComplete(msg,done,error,results,errors) {
	if(logger.active) logger.send("connectionProcessorComplete "+msg.cm.running);
	if(--msg.cm.running==0) {
		if(errors) {
			if(logger.active) logger.send("connectionProcessorComplete errors "+JSON.stringify(errors));
			error.apply(this,[results,errors]);
		} else {
			done.apply(this,[results]);
		}
	}
}
function connectionProcessor(msg,action,done,error,a1,a2) {
	if(logger.active) logger.send("connectionProcessor action: "+action+" arguments "+JSON.stringify({a1:a1,a2:a2}));
    msg.cm.running++;
	let c,results={},errors,pool;
	for(let connection in msg.cm.connection) {
		if(logger.active) logger.send("connectionProcessor connection: "+connection);
	    msg.cm.running++;
		c=msg.cm.connection[connection];
		pool=getPool(c.pool);
		pool[action].apply(pool,[c,
			(result)=>{
				results[connection]=result;
				connectionProcessorComplete(msg,done,error,results,errors);
			},
			(err)=>{
				if(logger.active) logger.send("connectionProcessor connection: "+connection+" error: "+err);
				errors=errors||{};
				try{
					errors[connection]=getMessageString(err);
				} catch(e) {
					logger.sendError("connectionProcessor catch error: "+e);
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
	if(logger.active) logger.send("cmProcessor action: "+action);
    if(!msg.cm) {done(); return;}
    const thisObject=this;
	stackProcessor.apply(this,[msg,action,
		()=>connectionProcessor.apply(thisObject,[msg,action,done,error,a1,a2]),
		()=>connectionProcessor.apply(thisObject,[msg,action,done,error,a1,a2])
	]);
}
function query(msg,connection,statement,params,done,error) {
	if(logger.active) logger.send("query connection: "+connection+" prepare: "+this.prepareSQL+" statement: "+statement);
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
		const pool=getPool(connector.pool);
		
		if(logger.active) logger.send("query connection: "+connection+" prepare: "+this.prepareSQL+" preparable: "+pool.preparable);
		if(this.prepareSQL && pool.preparable) {
			const node=this;
			pool.prepare(connector, 
				(prepared)=>pool.exec(prepared,done,error,params),
				(err)=>{
					if(logger.active) logger.send("query prepare error "+err);
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
				if(logger.active) logger.send("query error "+JSON.stringify(err));
				error({},err);
			},
			statement,
			params
		);
		return;
	}		
	if(logger.active) logger.send("query connection all connections");
	if(this.prepareSQL) {
		const node=this;
		connectionProcessor.apply(node,[msg,"prepare",
			(prepared)=>{
				if(logger.active) logger.send("query prepare exec node: "+node.id+" params: "+JSON.stringify(params));
				connectionProcessor.apply(node,[msg,"exec",done,error,node.id,params]);
			},
			(result,err)=>{
				if(logger.active) logger.send("query prepare error(s) "+JSON.stringify(err));
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
	if(logger.active) logger.send("release");
	if(msg.cm.autoCommit) {
		cmProcessor.apply(this,[msg,"release",done,error]);
		return;
	}
	const thisObject=this,   
		action=this.rollbackTransaction?"rollback":"commit";
	cmProcessor.apply(this,[msg,action,
		()=>{
			if(logger.active) logger.send("release "+action+" all now releasing");
			cmProcessor.apply(thisObject,[msg,"release",done,error]);
		},
		(err)=> {
			if(logger.active) logger.send("release "+action+" all with error now releasing "+JSON.stringify(err));
			cmProcessor.apply(thisObject,[msg,"release",
				(result)=>error(result,err),
				(result,e1)=>error(result,err+" and "+e1)
			]);
		},
	]);
}
function stackProcessor(msg,action,done,error) {
	if(logger.active) logger.send("stackProcessor action: "+action);
	if(msg.cm.stack.length==0) {
		if(msg.cm.running==0) done();
		return;
	}
	let r=msg.cm.stack.pop();
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
	try{
		this.driver=DriverType[this.driverType];
		if(this.driver==null) throw Error("Driver not supported");
		this.autoCommit=this.driver.autoCommit||true;
		this.preparable=!(this.driver.prepareIsQuery||false);
	} catch(ex) {
		const err="Driver load failed, may need install by 'npm install "+this.driverType+"', drivers aren't install by default to minimise foot print";
		this.node.error(err);
		logger.sendError("ConnectionPool "+ex.message);
	}
}
ConnectionPool.prototype.beginTransaction=function(c,done,error) {
	if(logger.active) logger.send("ConnectionPool beginTransaction");
	this.driver.beginTransaction(this,this.pool[c.id],done,error);
}
ConnectionPool.prototype.checkDeadConnection=function(c,errorMessage) {
	if(logger.active) logger.send({label:"ConnectionPool.checkDeadConnection"});
	const msg=getMessageString(errorMessage);
	if(this.driver.errorDeadConnection) {
		if(this.driver.errorDeadConnection.includes(msg)) {
			if(logger.active) logger.send("ConnectionPool.isDeadConnection set connection null and releasing");
			this.pool[c.id]=null;  // on release this deletes connection so not used again
			this.release(c);
		}
	}
};
ConnectionPool.prototype.close=function(c,done,error) {
	if(this.active.indexOf(c)>-1) {
		this.node.error("rolling back active connection as close issued");
		const thisObject=this;
		this.rollback.apply(this,[c,
			function() {thisObject.close(c,done,error);}
		]);
		this.returnConnection(c.id);
	} else{
		this.driver.close(this,c,done,error);
	}
};
ConnectionPool.prototype.closeAll=function(done) {
	this.node.log("closing all connections");
	let running=1;
	for(let c in this.pool) {
		running++;
		this.pool[n].close.apply(this.pool,[c,
			function(){if(--running) done();}
		]);
	}
	if(--running==0) done();
}
ConnectionPool.prototype.commit=function(c,done,error) {
	const pool=this;
	this.driver.commit(pool,this.pool[c.id],done,(err)=>{
		if(logger.active) logger.send("ConnectionPool commit "+err);
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
	if(logger.active) logger.send("ConnectionPool exec connection id: "+c.id+" prepared id: "+id+" params: "+JSON.stringify(params));
	if(!this.preparable) {
		this.query(c,done,error,this.prepared[c.id][id],params,id);
		return;
	}
	this.lastUsed[c.id]=new Date();
	const pool=this;
	this.driver.exec(pool,this.prepared[c.id][id],params,done,(err)=>{
		if(logger.active) logger.send("ConnectionPool exec "+err);
		pool.checkDeadConnection(c,err);
		error(err)
	});
};
ConnectionPool.prototype.getConnection=function(done,error) {
	if(logger.active) logger.send("ConnectionPool getConnection");
	let connectionPool=this;
	if(this.free.length) {
		if(logger.active) logger.send("ConnectionPool getConnection free");
		const c=connectionPool.free.pop();
		connectionPool.active.push(c);
		done( {id:c, pool:connectionPool.node.name} );
		return;
	}
	if(logger.active) logger.send("ConnectionPool getConnection create new connection");
	if(++this.newConnections>this.size) {  // this.pool.length updated too late 
		connectionPool.error("maximum pool size "+this.size,error);
		return;
	}
	this.driver.getConnection(connectionPool,this.node,
		function (connection) {
			connectionPool.node.log("new connection "+connectionPool.node.name);
			let c=connectionPool.pool.find((e)=>e==null);
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
	if(logger.active) logger.send("ConnectionPool prepare connection id: "+c.id+" prepare id: "+id+" sql: "+sql);
	if(this.prepared[c.id]) {
		if(logger.active) logger.send("ConnectionPool prepare already done");
		if(this.prepared[c.id][id]) {
			done(this.prepared[c.id][id]);
			return;
		}
	} else {
		this.prepared[c.id]={};
	}
	this.lastUsed[c.id]=new Date();
	if(!this.preparable) {
		if(logger.active) logger.send("ConnectionPool prepare not available, simulating prepare");
		try{
			this.prepared[c.id][id]=(this.driver.translateSQL?this.driver.translateSQL(sql):sql);
		} catch(ex) {
			if(logger.active) logger.send("ConnectionPool translateSQL "+ex.message);
			error(ex.message);
			return;
		}
		done(sql);
		return;
	}
	const pool=this;
	this.driver.prepare(pool,this.pool[c.id],(this.driver.translateSQL?this.driver.translateSQL(sql):sql),
		(prepared)=>{
			pool.prepared[c.id][id]=prepared;
			if(logger.active) logger.send("ConnectionPool prepared calling done");
			done(prepared);
		}, 
		(err)=>{
			if(logger.active) logger.send("ConnectionPool prepare "+err);
			error(err)
	});
};
ConnectionPool.prototype.query=function(c,done,error,sql,params,prepareid) {   
	if(logger.active) logger.send({label:"ConnectionPool query connection",id:c.id,sql:sql,parms:params,prepareid:prepareid});
	this.lastUsed[c.id]=new Date();
	const pool=this;
	this.driver.query(pool,this.pool[c.id],(this.driver.translateSQL?this.driver.translateSQL(sql):sql),params,done, (err)=>{
		if(logger.active) logger.send({label:"ConnectionPool query error",error:err});
		pool.checkDeadConnection(c,err);
		error(err);
	},prepareid);
};
ConnectionPool.prototype.release=function(c,done) {
	if(logger.active) logger.send("ConnectionPool.release "+c.id);
	this.returnConnection(c.id);
	if(done) done();
};
ConnectionPool.prototype.returnConnection=function(c) {
	if(logger.active) logger.send("ConnectionPool.returnConnection "+c);
	this.active.splice(this.active.indexOf(c),1);
	if(this.pool[c]==null) {
		if(logger.active) logger.send("ConnectionPool.returnConnection "+c+" is bad, not placed on free chain");
		return;
	}
	this.free.push(c);
};
ConnectionPool.prototype.rollback=function(c,done,error) {
	if(logger.active) logger.send("ConnectionPool.rollback ");
	const pool=this;
	this.driver.rollback(pool,this.pool[c.id],done,(err)=>{
		if(logger.active) logger.send("ConnectionPool rollback "+err);
		pool.checkDeadConnection(c,err);
		error(err)
	});
} 
ConnectionPool.prototype.releaseStaleConnections=function() {
	try{
		const thisObject=this,
			staleTimestamp= new Date(Date.now() - (1 * 60 * 1000));
		for(let connectionID in this.active) {
			if(this.lastUsed[connectionID] < staleTimestamp) {
				this.node.error("Releasing long running connection with rollback "+connectionID);
				this.driver.rollback.apply(this.driver,[
					thisObject,
					thisObject.pool[connectionID],
					()=>thisObject.release.apply(thisObject,[{id:connectionID},()=>{thisObject.node.log("Released connection with rollback "+connectionID);}]),
					(err)=>thisObject.release.apply(thisObject,[{id:connectionID},()=>{thisObject.node.warn("Releasing connection "+connectionID+" rollback failed: "+err);}])
				]);
			}
		}
	} catch(e) {
		logger.sendError("releaseStaleConnections failed: "+e)
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
}

module.exports = function(RED) {
    function ConnectionManagerNode(n) {
        RED.nodes.createNode(this,n);
        const node=Object.assign(this,n,{port:Number(n.port)});
        node.connectionPool=new ConnectionPool(node);
        node.toggleDebug=toggleDebug;
        Pools[node.name]=node.connectionPool;

        node.setMsg= function(msg,done,error) {
        	if(!msg.cm) {
        		const cm={id:node.id,running:0,connection:{},stack:[]
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
   RED.nodes.registerType(logger.label,ConnectionManagerNode,{
	   credentials: {
            user: {type: "text"},
            password: {type: "password"}
       }
   });
};

function Driver(a) {
	if(logger.active) logger.send({label:"New Drive ",argument:a});
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
Driver.prototype.batch=function(pool,conn,done,error) {
	const batch=conn.batch;
	if(batch==null) {
		done();
		return;
	}
	delete conn.batch;
	this.query(pool,conn,"begin batch "+batch.join(";")+" apply batch;",null,done,error); //cassandra form
}
Driver.prototype.beginTransactionNoAction=function(pool,conn,done,error) {
	if(logger.active) logger.send("Driver.beginTransactionNoAction");
	done();
}
Driver.prototype.beginTransactionSql=function(pool,conn,done,error) {
	if(logger.active) logger.send("Driver.beginTransactionSql");
	this.query(pool,conn,"Start Transaction",null,done,error);
};
Driver.prototype.close=function(pool,conn,done,error) {
	if(logger.active) logger.send("close");
	conn.close().then(done,(err,result)=>{
		if(error) {
			error(err);
			return;
		}
		done([{sql:sql,error:err}]);
	});
};
Driver.prototype.commitNoAction=function(pool,conn,done,error) {
	if(logger.active) logger.send("Driver.commitNoAction");
	done();
};
Driver.prototype.commitSql=function(pool,conn,done,error) {
	if(logger.active) logger.send("Driver.commit");
	this.query(pool,conn,"commit",null,done,error);
};
Driver.prototype.Driver=function() {
	return require(this.requireName).Client;
};
function optionsMap(node,options,optionsMapping){
	for(let i in optionsMapping ) {
		try{
			const propertyConfig=optionsMapping[i];
			if(logger.active) logger.send({label:"optionsMap",propery:i,"configuration property":propertyConfig});
			if(i === 'options'){
				if(propertyConfig) {
					const addOptions=JSON.parse(node.options);
					if(logger.active) logger.send({label:"optionsMap add options",options:addOptions});
					Object.assign(options,addOptions);
				}
				continue;
			} else if(typeof propertyConfig === 'string' || propertyConfig instanceof String){
				options[i]=(node.credentials && node.credentials.hasOwnProperty(propertyConfig))?
						node.credentials[propertyConfig]:
						node[propertyConfig];
			} else if(Array.isArray(propertyConfig)){
				options[i]=node[propertyConfig[0]].split(",");
			} else if(typeof propertyConfig == "object"){
				options[i]={};
				optionsMap(node,options[i],propertyConfig)
				return;
			} else
				throw Error("unknown mapping value "+propertyConfig);
			if(options[i]==null) throw Error("not set but expected");
		} catch(e) {
			node.error("option "+i+" set to configuration property "+optionsMapping[i]+" has problem "+e)
		}
	}
}
Driver.prototype.getOptions=function(node) {
	if(logger.active) logger.send("Driver.getOptions "+JSON.stringify(this.optionsMapping));
	if(!this.optionsCached) {
		this.optionsCached={}
		optionsMap(node,this.optionsCached,this.optionsMapping);
	}
	return this.optionsCached;
};
Driver.prototype.getConnectionC=function(pool,node,done,error) {
	try{
		const options=this.getOptions(node);
		if(logger.active) logger.send("getConnectionC options "+JSON.stringify(Object.assign({},options,{password:"***masked"})));
		const thisObject=this;
		const c=new (this.Driver())(options);
		c.connect((err)=>{
			if(err) {
				if(logger.active) logger.send("getConnectionC error "+err);
				error(err);
				return;
			}
			if(logger.active) logger.send("getConnectionC OK ");
			if(thisObject.testOnConnect) {
				if(!thisObject.onConnectCache) {
					const mustache=require("mustache"); 
					thisObject.onConnectCache=mustache.render(thisObject.testOnConnect,node);
				}
				thisObject.query(pool,c,thisObject.onConnectCache,null,()=>done(c),error);
			} else {
				done(c);
			}
		});
	} catch(e) {
		logger.sendError("Driver.getConnectionC error: "+e);
		error(e);
	}
};
Driver.prototype.getConnectionO=function(pool,node,done,error) {
	try{
		const options=this.getOptions(node);
		if(logger.active) logger.send("getConnectionC options "+JSON.stringify(Object.assign({},options,{password:"***masked"})));
		if(!this.driverInstance) this.driverInstance= new (this.Driver());
		let thisObject=this,
			connectString="DATABASE="+options.database+";HOSTNAME="+options.host+";UID="+options.user+";PWD="+options.password+";PORT="+options.port+";PROTOCOL=TCPIP";
		this.driverInstance.open(connectString,(err,conn)=>{
			if(err) {
				if(logger.active) logger.send("getConnectionO error "+err);
				error(err);
				return;
			}
			if(thisObject.testOnConnect) {
				thisObject.query(pool,conn,thisObject.testOnConnect,null,()=>done(conn),error);
			} else {
				done(conn);
			}
		});
	} catch(e) {
		logger.sendError("Driver.getConnectionC error: "+e);
		error(e);
	}
};
Driver.prototype.getConnectionNeo4j=function(pool,node,done,error) {
	try{
		const options=this.getOptions(node);
		if(logger.active) logger.send("getConnectionNeo4j options "+JSON.stringify(Object.assign({},options)));
		let neo4j=new this.Driver(),
			driver=neo4j.driver("bolt://"+options.host+":"+options.host, neo4j.auth.basic(options.user,options.password));
		if(!driver) throw Error("driver build failed");
		var session=driver.session();
		if(this.testOnConnect) {
			this.query(pool,session,this.testOnConnect,null,()=>done(session),error);
		} else {
			done(session);
		}
	} catch(e) {
		logger.sendError("Driver.getConnectionNeo4j error: "+e);
		error(e);
	}
};
Driver.prototype.getConnectionQ=function(pool,node,done,error) {
	try{
		const options=this.getOptions(node);
		if(logger.active) logger.send("getConnectionQ options "+JSON.stringify(Object.assign({},options,{password:"***masked"})));
		let c = new this.Driver(options),
			thisObject=this;
		c.connect(options).then(
			()=>{
				if(thisObject.testOnConnect) {
					thisObject.query(pool,c,thisObject.testOnConnect,null,()=>done(c),error);
				} else {
					done(c);
				}
			},
			(err)=>{
				if(logger.active) logger.send("query error "+err);
				error(err);
			}
		);
	} catch(e) {
		logger.sendError("Driver.getConnectionQ error: "+e);
		error(e);
	}
};
Driver.prototype.execC=function(pool,preparedSql,params,done,error) {
	if(logger.active) logger.send("Driver.execC "+JSON.stringify({params:params}));
	const thisObject=this;
	try{
		preparedSql.exec(params||this.paramNull,
			(result)=>{
				if(logger.active) logger.send("Driver.execC first 100 chars results"+JSON.stringify(result||"<null>").substring(1,100));
				done(result);
			},
			(err)=>{
				if(logger.active) logger.send("Driver.execC fail: "+err);
				try{
					error(err);
				} catch(e) {
					logger.sendError("Driver.execC fail error: "+e+" stack:\n"+e.stack);
				}
			}
		);
	} catch(e) {
		logger.sendError("Driver.execC error: "+e);
		error(e);
	}
};
Driver.prototype.execQ=function(pool,preparedSql,params,done,error) {
	if(logger.active) logger.send("Driver.execQ "+JSON.stringify({params:params}));
	const thisObject=this;
	try{
		preparedSql.exec(params||this.paramNull).then(
			(result)=>{
				if(logger.active) logger.send("Driver.execQ first 100 chars results"+JSON.stringify(result||"<null>").substring(1,100));
				done(result);
			},
			(err)=>{
				if(logger.active) logger.send("Driver.execQ fail: "+err);
				try{
					error(err);
				} catch(e) {
					logger.sendError("Driver.execQ fail error: "+e+" stack:\n"+e.stack);
				}
			}
		);
	} catch(e) {
		logger.sendError("Driver.execQ error: "+e);
		error(e);
	}
};
Driver.prototype.prepareC=function(pool,conn,sql,done,error) {
	if(logger.active) logger.send("Driver.prepareC "+JSON.stringify({sql:sql}));
	const thisObject=this;
	try{
		conn.prepare(sql,
			(prepResult)=>{
				if(logger.active) logger.send("Driver.prepareC prepared completed");
				done(prepResult);
			},
			(err)=>{
				if(logger.active) logger.send("Driver.prepareC fail: "+err);
				error(err);
			}
		);
	} catch(e) {
		logger.sendError("Driver.prepareC error: "+e);
		error(e);
	}
};
Driver.prototype.prepareQ=function(pool,conn,sql,done,error) {
	if(logger.active) logger.send("Driver.prepareQ "+JSON.stringify({sql:sql}));
	const thisObject=this;
	try{
		conn.prepare(sql).then(
			(prepResult)=>{
				if(logger.active) logger.send("Driver.prepareQ prepared completed");
				done(prepResult);
			},
			(err)=>{
				if(logger.active) logger.send("Driver.prepareQ fail: "+err);
				error(err);
			}
		);
	} catch(e) {
		logger.sendError("Driver.prepareQ error: "+e);
		error(e);
	}
};
Driver.prototype.queryC=function(pool,conn,sql,params,done,error) {
	if(logger.active) logger.send("Driver.queryC "+JSON.stringify({sql:sql,params:params}));
	const thisObject=this;
	try{
		conn.query(sql,(params||this.paramNull),(err, result) => {
			if(err) {
				if(logger.active) logger.send("Driver.queryC error: "+err);
				error(err);
			} else {
				if(logger.active) logger.send("Driver.queryC first 100 chars results"+JSON.stringify(result||"<null>").substring(1,100));
				done(result);
			}
		});
	} catch(e) {
		logger.sendError("Driver.queryC error: "+e);
		error(e);
	}
};
Driver.prototype.queryCE=function(pool,conn,sql,params,done,error) {
	if(logger.active) logger.send("Driver.queryCE "+JSON.stringify({sql:sql,params:params}));
	const thisObject=this;
	try{
		conn.execute(sql,(params||this.paramNull),(err, result) => {
			if(err) {
				if(logger.active) logger.send("Driver.queryCE error: "+err);
				error(err);
			} else {
				if(logger.active) logger.send("Driver.queryCE first 100 chars results"+JSON.stringify(result||"<null>").substring(1,100));
				done(result);
			}
		});
	} catch(e) {
		logger.sendError("Driver.queryC error: "+e);
		error(e);
	}
};
Driver.prototype.queryCEP=function(pool,conn,sql,params,done,error) {
	if(logger.active) logger.send("Driver.queryCEP "+JSON.stringify({sql:sql,params:params}));
	const thisObject=this;
	try{
		conn.execute(sql,(params||this.paramNull),{prepare:true},(err, result) => {
			if(err) {
				if(logger.active) logger.send("Driver.queryCEP error: "+err);
				error(err);
			} else {
				if(logger.active) logger.send("Driver.queryCEP first 100 chars results"+JSON.stringify(result||"<null>").substring(1,100));
				done(result);
			}
		});
	} catch(e) {
		logger.sendError("Driver.queryCEP error: "+e);
		error(e);
	}
};
Driver.prototype.queryCPG=function(pool,conn,sql,params,done,error) {
	const thisObject=this,
		query={text:sql,values:(params||this.paramNull)};
	if(pool.node.columnsAsArray) query.rowMode='array';
	if(logger.active) logger.send({label:"Driver.queryCPG ",query:query});
	try{
		conn.query(query,(err, result) => {
			if(err) {
				if(logger.active) logger.send("Driver.queryCPG error: "+err);
				error(err);
			} else {
				if(logger.active) logger.send("Driver.queryCPG first 100 chars results"+JSON.stringify(result||"<null>").substring(1,100));
				done(result);
			}
		});
	} catch(e) {
		logger.sendError("Driver.queryCPG error: "+e);
		error(e);
	}
},
Driver.prototype.queryNeo4j=function(pool,session,cmd,params,done,error) {
	if(logger.active) logger.send("Driver.queryNeo4j "+JSON.stringify({cmd:cmd,params:params}));
	try{
		session.run(cmd,(params||this.paramNull)).then(done).catch(error);
	} catch(e) {
		logger.sendError("Driver.queryNeo4j error: "+e);
		error(e);
	}
},
Driver.prototype.queryQ=function(pool,conn,sql,params,done,error) {
	if(logger.active) logger.send("Driver.queryQ "+JSON.stringify({sql:sql,params:params}));
	const thisObject=this;
	try{
		conn.query(sql,(params||this.paramNull)).then(
			(result)=>{
				if(logger.active) logger.send("Driver.queryQ first 100 chars results"+JSON.stringify(result||"<null>").substring(1,100));
				done(result);
			},
			(err)=>{
				if(logger.active) logger.send("Driver.queryQ fail: "+err);
				try{
					error(err);
				} catch(e) {
					logger.sendError("Driver.queryQ fail error: "+e+" stack:\n"+e.stack);
				}
			}
		);
	} catch(e) {
		logger.sendError("Driver.queryQ error: "+e);
		error(e);
	}
},
Driver.prototype.rollback=function(pool,conn,done,error) {
	if(logger.active) logger.send("Driver.rollback");
	this.query(pool,conn,"rollback",null,done,error);
};
Driver.prototype.translateSQL=function(sql) {
	return sql;
};
let DriverType = {
		'cassandra': new Driver({
			requireName:'cassandra-driver',
			query:Driver.prototype.queryCE,
			beginTransaction:Driver.prototype.beginTransactionNoAction,
			commit:Driver.prototype.commitNoAction,
			testOnConnect:"use {{dbname}}",
			prepareIsQuery:true,
			query:Driver.prototype.queryCEP,
			optionsMapping: {
				options:true,
				credentials: { username: 'user', password: 'password' },
				contactPoints: ['host'],
				localDataCenter: 'port',
				keyspace: 'dbname'
			}
		}),
		'db2': new Driver({
			Driver: function() {
				return require(this.requireName);
			},
			requireName:'ibm_db',
			getConnection: Driver.prototype.getConnectionO
		}),
		'dse': new Driver({
			requireName:'dse-driver',
			query:Driver.prototype.queryCE,
			beginTransaction:Driver.prototype.beginTransactionNoAction,
			commit:Driver.prototype.commitNoAction,
			testOnConnect:"use {{dbname}}",
			prepareIsQuery:true,
			query:Driver.prototype.queryCEP,
			optionsMapping: {
				options:true,
				credentials: { username: 'user', password: 'password' },
				contactPoints: ['host'],
				keyspace: 'dbname'
			}
		}),
		'monetdb': new Driver({
			Driver:(()=>require(this.requireName)({maxReconnects:0,debug:false})),
			requireName:'monetdb',
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
				return require(this.requireName).v1;
			},
			requireName:'neo4j-driver',
			autoCommit:false,
			beginTransaction:Driver.prototype.beginTransactionNoAction,
			commit:Driver.prototype.commitNoAction,
			prepareIsQuery:true,
			testOnConnect:null,
			getConnection: Driver.prototype.getConnectionNeo4j,
			query:Driver.prototype.queryNeo4j
		}),	
		'pg': new Driver({
			requireName:'pg',
			autoCommit:true,
			prepareIsQuery:true,
			query:Driver.prototype.queryCPG,
			translateSQL:function(sql) {
				return sql.split('?').reduce((a,c,i)=>a+="$"+i+c);
			}
		})
	};
