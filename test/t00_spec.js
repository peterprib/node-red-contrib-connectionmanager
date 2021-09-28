//const assert=require('assert');
  
describe('test drivers', function() {
    it('monetdb', function(done) {
    	const MDB = require('monetdb')({maxReconnects:0,debug:false});
    	const options = {
    	    host     : 'localhost', 
    	    port     : 50000, 
    	    dbname   : 'demo', 
//    	    user     : 'monetdb', 
//    	    password : 'monetdb'
    	};
    	 
    	const conn = new MDB(options);
    	conn.connect();
    	conn.query('SELECT * FROM mytable').then(function(result) {
    	    // Do something with the result
    	});
    	conn.close();
        done();
    });
    it(' ibm_db', function(done) {
    	const ibmdb = require('ibm_db');
    	const connStr = "DATABASE=sample;HOSTNAME=localhost;UID=db2admin;PWD=Db2ims01;PORT=50000;PROTOCOL=TCPIP";
    	ibmdb.open(connStr, function (err,conn) {
    	  if (err) return console.log(err);
    	  conn.query('select 1 from sysibm.sysdummy1', function (err, data) {
    	    if (err) console.log(err);
    	    else console.log(data);

    	    conn.close(function () {
    	      console.log('done');
    	    });
    	  });
    	});
        done();
    });
});