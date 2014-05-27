All services will implement the following methods

- configure


var auth = require('authenticationService')({
    store: cookieStore,
});
auth.login(username, password);
auth.logout([username]);

auth.getToken([username], [password]); //if already logged in, gets token from store. If not, logs in and then gets token

auth.store; //cookie store


//Create run behind the scenes on instantiation.. because what else will you do with a run service
var rs = require('runService')({
    token: '',
    apiKey: '',
    model: 'model.jl',
    account: 'mit',
    project: 'afv'
});

//explicitly create new run
rs.create(options);
rs.reset(options);// passes in old runid so mandelbrot can deassign

rs.toJSON(); // a.k.a rs.attributes. Implements underscore methods
rs.query({
    'saved': 'true',
    '.price': '>1'
}, // All Matrix parameters
{limit:5, page:2} //All Querystring params
);

//Query over-writes your params with the queryparams, filter merges
rs.filter({

})
rs.next();// If you got paged results initially, gets the next one, else null
/**
 * while (rs.next()) { console.log()}
 */

rs.get('<runid>', {include: '.score', set: 'xyz'});
rs.getVariables(); //returns object, implements _, gets from default set

rs.getVariables(["Price", "Sales"]);//shorthand, doesn't directly map to api
rs.getVariables("variableset", {include: ['price', 'sales']})
rs.getVariables({set: 'variableset', include:['price', 'sales']})
rs.getVariables({set: ['set1', 'set2'], include:['price', 'sales']});

rs.getVariables(..).get('X'); 10

rs.variables
    .query({});

rs.save({saved:true, variables: {a:23,b:23}})
rs.save({saved:true}).saveVariables({a:23, b:23})
rs.save({saved:true}).variables.save({a:23, b:23});
rs.save({saved:true}).variables.merge({a:23, b:[23,24]});

##Operations
rs.do('solve');
rs.do('add', [1,2]);
rs.serial(['initialize', 'solve', 'reset']).then(function(resetResult, solveResult, initializeResult){

});
rs.parallel(..);

rs.getOperations();//returns list of possible operations and arguments. Rarely likely to be used directly



