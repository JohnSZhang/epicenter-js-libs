'use strict';

var classFrom = require('../../../util/inherit');
var Base = require('./base-model');


module.exports = classFrom(Base, {
    defaults: {
        world: '',
        role: '',
        isWorldComplete: true
    }

});
