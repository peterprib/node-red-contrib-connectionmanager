# [node-red-contrib-connectionmanager][2]

------------------------------------------------------------


[Node-Red][1] generalized connection manager to allow connection pooling and UOW (unit of work) over multiple nodes.  Trying to enable a common framework for connections which includes common pooling to avoid the variance in implementations.  Should help minimize swap between technologies.  For SQL this can be achieve if ISO standard is followed.

## Features
* Connection acquired and used across a series of nodes so transactional UOW can be formed
* More than once connection can be involved in UOW
* Releases a connection if it has not been released for a minute.  Cater form workflows that have not properly completed or unexpected error 
* Managers driver for monetdb and postgres.  Note, drivers must be install separately and will be acquired when needed. 

## Node Summary

* Connection Manager - Configuration of connection pool including size 
* Get Connection - acquires a connection for the work flow
* Release Connection - releases all connections back to pool
* Statement - statement to be executed against connection pool or all connection pools
* Admin Connections - get details on pool and manage pool 

------------------------------------------------------------
# Node Detail

## Connection Manager

## Get Connection

## Release Connection 

## Statement

## Admin Connections


------------------------------------------------------------

# To Do List

1. Add transactional - option on connection manager and release to have commit/rollback
* Standardised results format, at moment default of driver
* Add more DBMS drivers
* Add NoSQL drivers
* Performance metrics
* Dynamically change size of pool
* Wait on connection to become free
* Configurable stale connection cycle


------------------------------------------------------------

# Install

Run the following command in the root directory of your Node-RED install

    npm install node-red-contrib-connectionmanager

Test/example flow in  test/testflow.json

------------------------------------------------------------

# Author

[Peter Prib][3]


[1]: http://nodered.org
[2]: https://www.npmjs.com/package/connectionmanager
[3]: https://github.com/peterprib
