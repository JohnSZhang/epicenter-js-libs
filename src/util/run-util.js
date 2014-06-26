/**
 * Utilities for working with the run service
*/
(function(){
var root = this;

var run= function () {

    return {
        /**
         * returns operations of the form [[op1,op2], [arg1, arg2]]
         * @param  {Object|Array|String} operations operations to perform
         * @param  {Array} arugments for operation
         * @return {String}    Matrix-format query parameters
         */
        normalizeOperations: function(operations, args) {
            if (!args) args = [];
            var returnList = {
                ops: [],
                args: []
            };

            //{add: [1,2], subtract: [2,4]}
            var _normalizePlainObjects = function(operations, returnList) {
                if (!returnList) returnList = {ops: [], args: []};
                $.each(operations, function(opn, arg) {
                    returnList.ops.push(opn);
                    returnList.args.push([].concat(arg));
                });
                return returnList;
            };
            //{name: 'add', params: [1]}
            var _normalizeStructuredObjects = function(operation, returnList) {
                if (!returnList) returnList = {ops: [], args: []};
                returnList.ops.push(operation.name);
                returnList.args.push([].concat(operation.params));
                return returnList;
            };

            var _normalizeObject = function(operation, returnList) {
                return ((operation.name) ? _normalizeStructuredObjects : _normalizePlainObjects)(operation, returnList);
            };

            var _normalizeLiterals = function(operation, args, returnList) {
                if (!returnList) returnList = {ops: [], args: []};
                returnList.ops.push(operation);
                returnList.args.push([].concat(args));
                return returnList;
            };


            var _normalizeArrays = function(operations, arg, returnList) {
                if (!returnList) returnList = {ops: [], args: []};
                $.each(operations, function(index, opn) {
                    if ($.isPlainObject(opn)) {
                        _normalizeObject(opn, returnList);
                    }
                    else {
                        _normalizeLiterals(opn, args[index], returnList);
                    }
                });
                return returnList;
            };

            if ($.isPlainObject(operations)) {
                _normalizeObject(operations, returnList);
            }
            else if($.isArray(operations)) {
               _normalizeArrays(operations, args, returnList);
            }
            else {
                _normalizeLiterals(operations, args, returnList);
            }

            return returnList;
        }
    };
}();


if (typeof exports !== 'undefined') {
    module.exports = run;
}
else {
    if (!root.F) { root.F = {};}
    if (!root.F.util) { root.F.util = {};}
    root.F.util.run = run;
}

}).call(this);
