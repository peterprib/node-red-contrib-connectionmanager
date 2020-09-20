//const assert=require('assert');

// Mocha Test Case
describe('Mocha Test Case', function() {
    it('test', function(done) {
    	
    	var ibmdb = require('ibm_db');
    	var connStr = "DATABASE=sample;HOSTNAME=localhost;UID=db2admin;PWD=Db2ims01;PORT=50000;PROTOCOL=TCPIP";

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