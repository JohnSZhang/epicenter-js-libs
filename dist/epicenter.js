(function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);var f=new Error("Cannot find module '"+o+"'");throw f.code="MODULE_NOT_FOUND",f}var l=n[o]={exports:{}};t[o][0].call(l.exports,function(e){var n=t[o][1][e];return s(n?n:e)},l,l.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){
/*!
 * The buffer module from node.js, for the browser.
 *
 * @author   Feross Aboukhadijeh <feross@feross.org> <http://feross.org>
 * @license  MIT
 */

var base64 = require('base64-js')
var ieee754 = require('ieee754')
var isArray = require('is-array')

exports.Buffer = Buffer
exports.SlowBuffer = SlowBuffer
exports.INSPECT_MAX_BYTES = 50
Buffer.poolSize = 8192 // not used by this implementation

var rootParent = {}

/**
 * If `Buffer.TYPED_ARRAY_SUPPORT`:
 *   === true    Use Uint8Array implementation (fastest)
 *   === false   Use Object implementation (most compatible, even IE6)
 *
 * Browsers that support typed arrays are IE 10+, Firefox 4+, Chrome 7+, Safari 5.1+,
 * Opera 11.6+, iOS 4.2+.
 *
 * Due to various browser bugs, sometimes the Object implementation will be used even
 * when the browser supports typed arrays.
 *
 * Note:
 *
 *   - Firefox 4-29 lacks support for adding new properties to `Uint8Array` instances,
 *     See: https://bugzilla.mozilla.org/show_bug.cgi?id=695438.
 *
 *   - Safari 5-7 lacks support for changing the `Object.prototype.constructor` property
 *     on objects.
 *
 *   - Chrome 9-10 is missing the `TypedArray.prototype.subarray` function.
 *
 *   - IE10 has a broken `TypedArray.prototype.subarray` function which returns arrays of
 *     incorrect length in some situations.

 * We detect these buggy browsers and set `Buffer.TYPED_ARRAY_SUPPORT` to `false` so they
 * get the Object implementation, which is slower but behaves correctly.
 */
Buffer.TYPED_ARRAY_SUPPORT = (function () {
  function Bar () {}
  try {
    var arr = new Uint8Array(1)
    arr.foo = function () { return 42 }
    arr.constructor = Bar
    return arr.foo() === 42 && // typed array instances can be augmented
        arr.constructor === Bar && // constructor can be set
        typeof arr.subarray === 'function' && // chrome 9-10 lack `subarray`
        arr.subarray(1, 1).byteLength === 0 // ie10 has broken `subarray`
  } catch (e) {
    return false
  }
})()

function kMaxLength () {
  return Buffer.TYPED_ARRAY_SUPPORT
    ? 0x7fffffff
    : 0x3fffffff
}

/**
 * Class: Buffer
 * =============
 *
 * The Buffer constructor returns instances of `Uint8Array` that are augmented
 * with function properties for all the node `Buffer` API functions. We use
 * `Uint8Array` so that square bracket notation works as expected -- it returns
 * a single octet.
 *
 * By augmenting the instances, we can avoid modifying the `Uint8Array`
 * prototype.
 */
function Buffer (arg) {
  if (!(this instanceof Buffer)) {
    // Avoid going through an ArgumentsAdaptorTrampoline in the common case.
    if (arguments.length > 1) return new Buffer(arg, arguments[1])
    return new Buffer(arg)
  }

  this.length = 0
  this.parent = undefined

  // Common case.
  if (typeof arg === 'number') {
    return fromNumber(this, arg)
  }

  // Slightly less common case.
  if (typeof arg === 'string') {
    return fromString(this, arg, arguments.length > 1 ? arguments[1] : 'utf8')
  }

  // Unusual.
  return fromObject(this, arg)
}

function fromNumber (that, length) {
  that = allocate(that, length < 0 ? 0 : checked(length) | 0)
  if (!Buffer.TYPED_ARRAY_SUPPORT) {
    for (var i = 0; i < length; i++) {
      that[i] = 0
    }
  }
  return that
}

function fromString (that, string, encoding) {
  if (typeof encoding !== 'string' || encoding === '') encoding = 'utf8'

  // Assumption: byteLength() return value is always < kMaxLength.
  var length = byteLength(string, encoding) | 0
  that = allocate(that, length)

  that.write(string, encoding)
  return that
}

function fromObject (that, object) {
  if (Buffer.isBuffer(object)) return fromBuffer(that, object)

  if (isArray(object)) return fromArray(that, object)

  if (object == null) {
    throw new TypeError('must start with number, buffer, array or string')
  }

  if (typeof ArrayBuffer !== 'undefined') {
    if (object.buffer instanceof ArrayBuffer) {
      return fromTypedArray(that, object)
    }
    if (object instanceof ArrayBuffer) {
      return fromArrayBuffer(that, object)
    }
  }

  if (object.length) return fromArrayLike(that, object)

  return fromJsonObject(that, object)
}

function fromBuffer (that, buffer) {
  var length = checked(buffer.length) | 0
  that = allocate(that, length)
  buffer.copy(that, 0, 0, length)
  return that
}

function fromArray (that, array) {
  var length = checked(array.length) | 0
  that = allocate(that, length)
  for (var i = 0; i < length; i += 1) {
    that[i] = array[i] & 255
  }
  return that
}

// Duplicate of fromArray() to keep fromArray() monomorphic.
function fromTypedArray (that, array) {
  var length = checked(array.length) | 0
  that = allocate(that, length)
  // Truncating the elements is probably not what people expect from typed
  // arrays with BYTES_PER_ELEMENT > 1 but it's compatible with the behavior
  // of the old Buffer constructor.
  for (var i = 0; i < length; i += 1) {
    that[i] = array[i] & 255
  }
  return that
}

function fromArrayBuffer (that, array) {
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    // Return an augmented `Uint8Array` instance, for best performance
    array.byteLength
    that = Buffer._augment(new Uint8Array(array))
  } else {
    // Fallback: Return an object instance of the Buffer class
    that = fromTypedArray(that, new Uint8Array(array))
  }
  return that
}

function fromArrayLike (that, array) {
  var length = checked(array.length) | 0
  that = allocate(that, length)
  for (var i = 0; i < length; i += 1) {
    that[i] = array[i] & 255
  }
  return that
}

// Deserialize { type: 'Buffer', data: [1,2,3,...] } into a Buffer object.
// Returns a zero-length buffer for inputs that don't conform to the spec.
function fromJsonObject (that, object) {
  var array
  var length = 0

  if (object.type === 'Buffer' && isArray(object.data)) {
    array = object.data
    length = checked(array.length) | 0
  }
  that = allocate(that, length)

  for (var i = 0; i < length; i += 1) {
    that[i] = array[i] & 255
  }
  return that
}

function allocate (that, length) {
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    // Return an augmented `Uint8Array` instance, for best performance
    that = Buffer._augment(new Uint8Array(length))
  } else {
    // Fallback: Return an object instance of the Buffer class
    that.length = length
    that._isBuffer = true
  }

  var fromPool = length !== 0 && length <= Buffer.poolSize >>> 1
  if (fromPool) that.parent = rootParent

  return that
}

function checked (length) {
  // Note: cannot use `length < kMaxLength` here because that fails when
  // length is NaN (which is otherwise coerced to zero.)
  if (length >= kMaxLength()) {
    throw new RangeError('Attempt to allocate Buffer larger than maximum ' +
                         'size: 0x' + kMaxLength().toString(16) + ' bytes')
  }
  return length | 0
}

function SlowBuffer (subject, encoding) {
  if (!(this instanceof SlowBuffer)) return new SlowBuffer(subject, encoding)

  var buf = new Buffer(subject, encoding)
  delete buf.parent
  return buf
}

Buffer.isBuffer = function isBuffer (b) {
  return !!(b != null && b._isBuffer)
}

Buffer.compare = function compare (a, b) {
  if (!Buffer.isBuffer(a) || !Buffer.isBuffer(b)) {
    throw new TypeError('Arguments must be Buffers')
  }

  if (a === b) return 0

  var x = a.length
  var y = b.length

  var i = 0
  var len = Math.min(x, y)
  while (i < len) {
    if (a[i] !== b[i]) break

    ++i
  }

  if (i !== len) {
    x = a[i]
    y = b[i]
  }

  if (x < y) return -1
  if (y < x) return 1
  return 0
}

Buffer.isEncoding = function isEncoding (encoding) {
  switch (String(encoding).toLowerCase()) {
    case 'hex':
    case 'utf8':
    case 'utf-8':
    case 'ascii':
    case 'binary':
    case 'base64':
    case 'raw':
    case 'ucs2':
    case 'ucs-2':
    case 'utf16le':
    case 'utf-16le':
      return true
    default:
      return false
  }
}

Buffer.concat = function concat (list, length) {
  if (!isArray(list)) throw new TypeError('list argument must be an Array of Buffers.')

  if (list.length === 0) {
    return new Buffer(0)
  }

  var i
  if (length === undefined) {
    length = 0
    for (i = 0; i < list.length; i++) {
      length += list[i].length
    }
  }

  var buf = new Buffer(length)
  var pos = 0
  for (i = 0; i < list.length; i++) {
    var item = list[i]
    item.copy(buf, pos)
    pos += item.length
  }
  return buf
}

function byteLength (string, encoding) {
  if (typeof string !== 'string') string = '' + string

  var len = string.length
  if (len === 0) return 0

  // Use a for loop to avoid recursion
  var loweredCase = false
  for (;;) {
    switch (encoding) {
      case 'ascii':
      case 'binary':
      // Deprecated
      case 'raw':
      case 'raws':
        return len
      case 'utf8':
      case 'utf-8':
        return utf8ToBytes(string).length
      case 'ucs2':
      case 'ucs-2':
      case 'utf16le':
      case 'utf-16le':
        return len * 2
      case 'hex':
        return len >>> 1
      case 'base64':
        return base64ToBytes(string).length
      default:
        if (loweredCase) return utf8ToBytes(string).length // assume utf8
        encoding = ('' + encoding).toLowerCase()
        loweredCase = true
    }
  }
}
Buffer.byteLength = byteLength

// pre-set for values that may exist in the future
Buffer.prototype.length = undefined
Buffer.prototype.parent = undefined

function slowToString (encoding, start, end) {
  var loweredCase = false

  start = start | 0
  end = end === undefined || end === Infinity ? this.length : end | 0

  if (!encoding) encoding = 'utf8'
  if (start < 0) start = 0
  if (end > this.length) end = this.length
  if (end <= start) return ''

  while (true) {
    switch (encoding) {
      case 'hex':
        return hexSlice(this, start, end)

      case 'utf8':
      case 'utf-8':
        return utf8Slice(this, start, end)

      case 'ascii':
        return asciiSlice(this, start, end)

      case 'binary':
        return binarySlice(this, start, end)

      case 'base64':
        return base64Slice(this, start, end)

      case 'ucs2':
      case 'ucs-2':
      case 'utf16le':
      case 'utf-16le':
        return utf16leSlice(this, start, end)

      default:
        if (loweredCase) throw new TypeError('Unknown encoding: ' + encoding)
        encoding = (encoding + '').toLowerCase()
        loweredCase = true
    }
  }
}

Buffer.prototype.toString = function toString () {
  var length = this.length | 0
  if (length === 0) return ''
  if (arguments.length === 0) return utf8Slice(this, 0, length)
  return slowToString.apply(this, arguments)
}

Buffer.prototype.equals = function equals (b) {
  if (!Buffer.isBuffer(b)) throw new TypeError('Argument must be a Buffer')
  if (this === b) return true
  return Buffer.compare(this, b) === 0
}

Buffer.prototype.inspect = function inspect () {
  var str = ''
  var max = exports.INSPECT_MAX_BYTES
  if (this.length > 0) {
    str = this.toString('hex', 0, max).match(/.{2}/g).join(' ')
    if (this.length > max) str += ' ... '
  }
  return '<Buffer ' + str + '>'
}

Buffer.prototype.compare = function compare (b) {
  if (!Buffer.isBuffer(b)) throw new TypeError('Argument must be a Buffer')
  if (this === b) return 0
  return Buffer.compare(this, b)
}

Buffer.prototype.indexOf = function indexOf (val, byteOffset) {
  if (byteOffset > 0x7fffffff) byteOffset = 0x7fffffff
  else if (byteOffset < -0x80000000) byteOffset = -0x80000000
  byteOffset >>= 0

  if (this.length === 0) return -1
  if (byteOffset >= this.length) return -1

  // Negative offsets start from the end of the buffer
  if (byteOffset < 0) byteOffset = Math.max(this.length + byteOffset, 0)

  if (typeof val === 'string') {
    if (val.length === 0) return -1 // special case: looking for empty string always fails
    return String.prototype.indexOf.call(this, val, byteOffset)
  }
  if (Buffer.isBuffer(val)) {
    return arrayIndexOf(this, val, byteOffset)
  }
  if (typeof val === 'number') {
    if (Buffer.TYPED_ARRAY_SUPPORT && Uint8Array.prototype.indexOf === 'function') {
      return Uint8Array.prototype.indexOf.call(this, val, byteOffset)
    }
    return arrayIndexOf(this, [ val ], byteOffset)
  }

  function arrayIndexOf (arr, val, byteOffset) {
    var foundIndex = -1
    for (var i = 0; byteOffset + i < arr.length; i++) {
      if (arr[byteOffset + i] === val[foundIndex === -1 ? 0 : i - foundIndex]) {
        if (foundIndex === -1) foundIndex = i
        if (i - foundIndex + 1 === val.length) return byteOffset + foundIndex
      } else {
        foundIndex = -1
      }
    }
    return -1
  }

  throw new TypeError('val must be string, number or Buffer')
}

// `get` is deprecated
Buffer.prototype.get = function get (offset) {
  console.log('.get() is deprecated. Access using array indexes instead.')
  return this.readUInt8(offset)
}

// `set` is deprecated
Buffer.prototype.set = function set (v, offset) {
  console.log('.set() is deprecated. Access using array indexes instead.')
  return this.writeUInt8(v, offset)
}

function hexWrite (buf, string, offset, length) {
  offset = Number(offset) || 0
  var remaining = buf.length - offset
  if (!length) {
    length = remaining
  } else {
    length = Number(length)
    if (length > remaining) {
      length = remaining
    }
  }

  // must be an even number of digits
  var strLen = string.length
  if (strLen % 2 !== 0) throw new Error('Invalid hex string')

  if (length > strLen / 2) {
    length = strLen / 2
  }
  for (var i = 0; i < length; i++) {
    var parsed = parseInt(string.substr(i * 2, 2), 16)
    if (isNaN(parsed)) throw new Error('Invalid hex string')
    buf[offset + i] = parsed
  }
  return i
}

function utf8Write (buf, string, offset, length) {
  return blitBuffer(utf8ToBytes(string, buf.length - offset), buf, offset, length)
}

function asciiWrite (buf, string, offset, length) {
  return blitBuffer(asciiToBytes(string), buf, offset, length)
}

function binaryWrite (buf, string, offset, length) {
  return asciiWrite(buf, string, offset, length)
}

function base64Write (buf, string, offset, length) {
  return blitBuffer(base64ToBytes(string), buf, offset, length)
}

function ucs2Write (buf, string, offset, length) {
  return blitBuffer(utf16leToBytes(string, buf.length - offset), buf, offset, length)
}

Buffer.prototype.write = function write (string, offset, length, encoding) {
  // Buffer#write(string)
  if (offset === undefined) {
    encoding = 'utf8'
    length = this.length
    offset = 0
  // Buffer#write(string, encoding)
  } else if (length === undefined && typeof offset === 'string') {
    encoding = offset
    length = this.length
    offset = 0
  // Buffer#write(string, offset[, length][, encoding])
  } else if (isFinite(offset)) {
    offset = offset | 0
    if (isFinite(length)) {
      length = length | 0
      if (encoding === undefined) encoding = 'utf8'
    } else {
      encoding = length
      length = undefined
    }
  // legacy write(string, encoding, offset, length) - remove in v0.13
  } else {
    var swap = encoding
    encoding = offset
    offset = length | 0
    length = swap
  }

  var remaining = this.length - offset
  if (length === undefined || length > remaining) length = remaining

  if ((string.length > 0 && (length < 0 || offset < 0)) || offset > this.length) {
    throw new RangeError('attempt to write outside buffer bounds')
  }

  if (!encoding) encoding = 'utf8'

  var loweredCase = false
  for (;;) {
    switch (encoding) {
      case 'hex':
        return hexWrite(this, string, offset, length)

      case 'utf8':
      case 'utf-8':
        return utf8Write(this, string, offset, length)

      case 'ascii':
        return asciiWrite(this, string, offset, length)

      case 'binary':
        return binaryWrite(this, string, offset, length)

      case 'base64':
        // Warning: maxLength not taken into account in base64Write
        return base64Write(this, string, offset, length)

      case 'ucs2':
      case 'ucs-2':
      case 'utf16le':
      case 'utf-16le':
        return ucs2Write(this, string, offset, length)

      default:
        if (loweredCase) throw new TypeError('Unknown encoding: ' + encoding)
        encoding = ('' + encoding).toLowerCase()
        loweredCase = true
    }
  }
}

Buffer.prototype.toJSON = function toJSON () {
  return {
    type: 'Buffer',
    data: Array.prototype.slice.call(this._arr || this, 0)
  }
}

function base64Slice (buf, start, end) {
  if (start === 0 && end === buf.length) {
    return base64.fromByteArray(buf)
  } else {
    return base64.fromByteArray(buf.slice(start, end))
  }
}

function utf8Slice (buf, start, end) {
  end = Math.min(buf.length, end)
  var firstByte
  var secondByte
  var thirdByte
  var fourthByte
  var bytesPerSequence
  var tempCodePoint
  var codePoint
  var res = []
  var i = start

  for (; i < end; i += bytesPerSequence) {
    firstByte = buf[i]
    codePoint = 0xFFFD

    if (firstByte > 0xEF) {
      bytesPerSequence = 4
    } else if (firstByte > 0xDF) {
      bytesPerSequence = 3
    } else if (firstByte > 0xBF) {
      bytesPerSequence = 2
    } else {
      bytesPerSequence = 1
    }

    if (i + bytesPerSequence <= end) {
      switch (bytesPerSequence) {
        case 1:
          if (firstByte < 0x80) {
            codePoint = firstByte
          }
          break
        case 2:
          secondByte = buf[i + 1]
          if ((secondByte & 0xC0) === 0x80) {
            tempCodePoint = (firstByte & 0x1F) << 0x6 | (secondByte & 0x3F)
            if (tempCodePoint > 0x7F) {
              codePoint = tempCodePoint
            }
          }
          break
        case 3:
          secondByte = buf[i + 1]
          thirdByte = buf[i + 2]
          if ((secondByte & 0xC0) === 0x80 && (thirdByte & 0xC0) === 0x80) {
            tempCodePoint = (firstByte & 0xF) << 0xC | (secondByte & 0x3F) << 0x6 | (thirdByte & 0x3F)
            if (tempCodePoint > 0x7FF && (tempCodePoint < 0xD800 || tempCodePoint > 0xDFFF)) {
              codePoint = tempCodePoint
            }
          }
          break
        case 4:
          secondByte = buf[i + 1]
          thirdByte = buf[i + 2]
          fourthByte = buf[i + 3]
          if ((secondByte & 0xC0) === 0x80 && (thirdByte & 0xC0) === 0x80 && (fourthByte & 0xC0) === 0x80) {
            tempCodePoint = (firstByte & 0xF) << 0x12 | (secondByte & 0x3F) << 0xC | (thirdByte & 0x3F) << 0x6 | (fourthByte & 0x3F)
            if (tempCodePoint > 0xFFFF && tempCodePoint < 0x110000) {
              codePoint = tempCodePoint
            }
          }
      }
    }

    if (codePoint === 0xFFFD) {
      // we generated an invalid codePoint so make sure to only advance by 1 byte
      bytesPerSequence = 1
    } else if (codePoint > 0xFFFF) {
      // encode to utf16 (surrogate pair dance)
      codePoint -= 0x10000
      res.push(codePoint >>> 10 & 0x3FF | 0xD800)
      codePoint = 0xDC00 | codePoint & 0x3FF
    }

    res.push(codePoint)
  }

  return String.fromCharCode.apply(String, res)
}

function asciiSlice (buf, start, end) {
  var ret = ''
  end = Math.min(buf.length, end)

  for (var i = start; i < end; i++) {
    ret += String.fromCharCode(buf[i] & 0x7F)
  }
  return ret
}

function binarySlice (buf, start, end) {
  var ret = ''
  end = Math.min(buf.length, end)

  for (var i = start; i < end; i++) {
    ret += String.fromCharCode(buf[i])
  }
  return ret
}

function hexSlice (buf, start, end) {
  var len = buf.length

  if (!start || start < 0) start = 0
  if (!end || end < 0 || end > len) end = len

  var out = ''
  for (var i = start; i < end; i++) {
    out += toHex(buf[i])
  }
  return out
}

function utf16leSlice (buf, start, end) {
  var bytes = buf.slice(start, end)
  var res = ''
  for (var i = 0; i < bytes.length; i += 2) {
    res += String.fromCharCode(bytes[i] + bytes[i + 1] * 256)
  }
  return res
}

Buffer.prototype.slice = function slice (start, end) {
  var len = this.length
  start = ~~start
  end = end === undefined ? len : ~~end

  if (start < 0) {
    start += len
    if (start < 0) start = 0
  } else if (start > len) {
    start = len
  }

  if (end < 0) {
    end += len
    if (end < 0) end = 0
  } else if (end > len) {
    end = len
  }

  if (end < start) end = start

  var newBuf
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    newBuf = Buffer._augment(this.subarray(start, end))
  } else {
    var sliceLen = end - start
    newBuf = new Buffer(sliceLen, undefined)
    for (var i = 0; i < sliceLen; i++) {
      newBuf[i] = this[i + start]
    }
  }

  if (newBuf.length) newBuf.parent = this.parent || this

  return newBuf
}

/*
 * Need to make sure that buffer isn't trying to write out of bounds.
 */
function checkOffset (offset, ext, length) {
  if ((offset % 1) !== 0 || offset < 0) throw new RangeError('offset is not uint')
  if (offset + ext > length) throw new RangeError('Trying to access beyond buffer length')
}

Buffer.prototype.readUIntLE = function readUIntLE (offset, byteLength, noAssert) {
  offset = offset | 0
  byteLength = byteLength | 0
  if (!noAssert) checkOffset(offset, byteLength, this.length)

  var val = this[offset]
  var mul = 1
  var i = 0
  while (++i < byteLength && (mul *= 0x100)) {
    val += this[offset + i] * mul
  }

  return val
}

Buffer.prototype.readUIntBE = function readUIntBE (offset, byteLength, noAssert) {
  offset = offset | 0
  byteLength = byteLength | 0
  if (!noAssert) {
    checkOffset(offset, byteLength, this.length)
  }

  var val = this[offset + --byteLength]
  var mul = 1
  while (byteLength > 0 && (mul *= 0x100)) {
    val += this[offset + --byteLength] * mul
  }

  return val
}

Buffer.prototype.readUInt8 = function readUInt8 (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 1, this.length)
  return this[offset]
}

Buffer.prototype.readUInt16LE = function readUInt16LE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 2, this.length)
  return this[offset] | (this[offset + 1] << 8)
}

Buffer.prototype.readUInt16BE = function readUInt16BE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 2, this.length)
  return (this[offset] << 8) | this[offset + 1]
}

Buffer.prototype.readUInt32LE = function readUInt32LE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 4, this.length)

  return ((this[offset]) |
      (this[offset + 1] << 8) |
      (this[offset + 2] << 16)) +
      (this[offset + 3] * 0x1000000)
}

Buffer.prototype.readUInt32BE = function readUInt32BE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 4, this.length)

  return (this[offset] * 0x1000000) +
    ((this[offset + 1] << 16) |
    (this[offset + 2] << 8) |
    this[offset + 3])
}

Buffer.prototype.readIntLE = function readIntLE (offset, byteLength, noAssert) {
  offset = offset | 0
  byteLength = byteLength | 0
  if (!noAssert) checkOffset(offset, byteLength, this.length)

  var val = this[offset]
  var mul = 1
  var i = 0
  while (++i < byteLength && (mul *= 0x100)) {
    val += this[offset + i] * mul
  }
  mul *= 0x80

  if (val >= mul) val -= Math.pow(2, 8 * byteLength)

  return val
}

Buffer.prototype.readIntBE = function readIntBE (offset, byteLength, noAssert) {
  offset = offset | 0
  byteLength = byteLength | 0
  if (!noAssert) checkOffset(offset, byteLength, this.length)

  var i = byteLength
  var mul = 1
  var val = this[offset + --i]
  while (i > 0 && (mul *= 0x100)) {
    val += this[offset + --i] * mul
  }
  mul *= 0x80

  if (val >= mul) val -= Math.pow(2, 8 * byteLength)

  return val
}

Buffer.prototype.readInt8 = function readInt8 (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 1, this.length)
  if (!(this[offset] & 0x80)) return (this[offset])
  return ((0xff - this[offset] + 1) * -1)
}

Buffer.prototype.readInt16LE = function readInt16LE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 2, this.length)
  var val = this[offset] | (this[offset + 1] << 8)
  return (val & 0x8000) ? val | 0xFFFF0000 : val
}

Buffer.prototype.readInt16BE = function readInt16BE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 2, this.length)
  var val = this[offset + 1] | (this[offset] << 8)
  return (val & 0x8000) ? val | 0xFFFF0000 : val
}

Buffer.prototype.readInt32LE = function readInt32LE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 4, this.length)

  return (this[offset]) |
    (this[offset + 1] << 8) |
    (this[offset + 2] << 16) |
    (this[offset + 3] << 24)
}

Buffer.prototype.readInt32BE = function readInt32BE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 4, this.length)

  return (this[offset] << 24) |
    (this[offset + 1] << 16) |
    (this[offset + 2] << 8) |
    (this[offset + 3])
}

Buffer.prototype.readFloatLE = function readFloatLE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 4, this.length)
  return ieee754.read(this, offset, true, 23, 4)
}

Buffer.prototype.readFloatBE = function readFloatBE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 4, this.length)
  return ieee754.read(this, offset, false, 23, 4)
}

Buffer.prototype.readDoubleLE = function readDoubleLE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 8, this.length)
  return ieee754.read(this, offset, true, 52, 8)
}

Buffer.prototype.readDoubleBE = function readDoubleBE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 8, this.length)
  return ieee754.read(this, offset, false, 52, 8)
}

function checkInt (buf, value, offset, ext, max, min) {
  if (!Buffer.isBuffer(buf)) throw new TypeError('buffer must be a Buffer instance')
  if (value > max || value < min) throw new RangeError('value is out of bounds')
  if (offset + ext > buf.length) throw new RangeError('index out of range')
}

Buffer.prototype.writeUIntLE = function writeUIntLE (value, offset, byteLength, noAssert) {
  value = +value
  offset = offset | 0
  byteLength = byteLength | 0
  if (!noAssert) checkInt(this, value, offset, byteLength, Math.pow(2, 8 * byteLength), 0)

  var mul = 1
  var i = 0
  this[offset] = value & 0xFF
  while (++i < byteLength && (mul *= 0x100)) {
    this[offset + i] = (value / mul) & 0xFF
  }

  return offset + byteLength
}

Buffer.prototype.writeUIntBE = function writeUIntBE (value, offset, byteLength, noAssert) {
  value = +value
  offset = offset | 0
  byteLength = byteLength | 0
  if (!noAssert) checkInt(this, value, offset, byteLength, Math.pow(2, 8 * byteLength), 0)

  var i = byteLength - 1
  var mul = 1
  this[offset + i] = value & 0xFF
  while (--i >= 0 && (mul *= 0x100)) {
    this[offset + i] = (value / mul) & 0xFF
  }

  return offset + byteLength
}

Buffer.prototype.writeUInt8 = function writeUInt8 (value, offset, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) checkInt(this, value, offset, 1, 0xff, 0)
  if (!Buffer.TYPED_ARRAY_SUPPORT) value = Math.floor(value)
  this[offset] = value
  return offset + 1
}

function objectWriteUInt16 (buf, value, offset, littleEndian) {
  if (value < 0) value = 0xffff + value + 1
  for (var i = 0, j = Math.min(buf.length - offset, 2); i < j; i++) {
    buf[offset + i] = (value & (0xff << (8 * (littleEndian ? i : 1 - i)))) >>>
      (littleEndian ? i : 1 - i) * 8
  }
}

Buffer.prototype.writeUInt16LE = function writeUInt16LE (value, offset, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) checkInt(this, value, offset, 2, 0xffff, 0)
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset] = value
    this[offset + 1] = (value >>> 8)
  } else {
    objectWriteUInt16(this, value, offset, true)
  }
  return offset + 2
}

Buffer.prototype.writeUInt16BE = function writeUInt16BE (value, offset, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) checkInt(this, value, offset, 2, 0xffff, 0)
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset] = (value >>> 8)
    this[offset + 1] = value
  } else {
    objectWriteUInt16(this, value, offset, false)
  }
  return offset + 2
}

function objectWriteUInt32 (buf, value, offset, littleEndian) {
  if (value < 0) value = 0xffffffff + value + 1
  for (var i = 0, j = Math.min(buf.length - offset, 4); i < j; i++) {
    buf[offset + i] = (value >>> (littleEndian ? i : 3 - i) * 8) & 0xff
  }
}

Buffer.prototype.writeUInt32LE = function writeUInt32LE (value, offset, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) checkInt(this, value, offset, 4, 0xffffffff, 0)
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset + 3] = (value >>> 24)
    this[offset + 2] = (value >>> 16)
    this[offset + 1] = (value >>> 8)
    this[offset] = value
  } else {
    objectWriteUInt32(this, value, offset, true)
  }
  return offset + 4
}

Buffer.prototype.writeUInt32BE = function writeUInt32BE (value, offset, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) checkInt(this, value, offset, 4, 0xffffffff, 0)
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset] = (value >>> 24)
    this[offset + 1] = (value >>> 16)
    this[offset + 2] = (value >>> 8)
    this[offset + 3] = value
  } else {
    objectWriteUInt32(this, value, offset, false)
  }
  return offset + 4
}

Buffer.prototype.writeIntLE = function writeIntLE (value, offset, byteLength, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) {
    var limit = Math.pow(2, 8 * byteLength - 1)

    checkInt(this, value, offset, byteLength, limit - 1, -limit)
  }

  var i = 0
  var mul = 1
  var sub = value < 0 ? 1 : 0
  this[offset] = value & 0xFF
  while (++i < byteLength && (mul *= 0x100)) {
    this[offset + i] = ((value / mul) >> 0) - sub & 0xFF
  }

  return offset + byteLength
}

Buffer.prototype.writeIntBE = function writeIntBE (value, offset, byteLength, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) {
    var limit = Math.pow(2, 8 * byteLength - 1)

    checkInt(this, value, offset, byteLength, limit - 1, -limit)
  }

  var i = byteLength - 1
  var mul = 1
  var sub = value < 0 ? 1 : 0
  this[offset + i] = value & 0xFF
  while (--i >= 0 && (mul *= 0x100)) {
    this[offset + i] = ((value / mul) >> 0) - sub & 0xFF
  }

  return offset + byteLength
}

Buffer.prototype.writeInt8 = function writeInt8 (value, offset, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) checkInt(this, value, offset, 1, 0x7f, -0x80)
  if (!Buffer.TYPED_ARRAY_SUPPORT) value = Math.floor(value)
  if (value < 0) value = 0xff + value + 1
  this[offset] = value
  return offset + 1
}

Buffer.prototype.writeInt16LE = function writeInt16LE (value, offset, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) checkInt(this, value, offset, 2, 0x7fff, -0x8000)
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset] = value
    this[offset + 1] = (value >>> 8)
  } else {
    objectWriteUInt16(this, value, offset, true)
  }
  return offset + 2
}

Buffer.prototype.writeInt16BE = function writeInt16BE (value, offset, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) checkInt(this, value, offset, 2, 0x7fff, -0x8000)
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset] = (value >>> 8)
    this[offset + 1] = value
  } else {
    objectWriteUInt16(this, value, offset, false)
  }
  return offset + 2
}

Buffer.prototype.writeInt32LE = function writeInt32LE (value, offset, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) checkInt(this, value, offset, 4, 0x7fffffff, -0x80000000)
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset] = value
    this[offset + 1] = (value >>> 8)
    this[offset + 2] = (value >>> 16)
    this[offset + 3] = (value >>> 24)
  } else {
    objectWriteUInt32(this, value, offset, true)
  }
  return offset + 4
}

Buffer.prototype.writeInt32BE = function writeInt32BE (value, offset, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) checkInt(this, value, offset, 4, 0x7fffffff, -0x80000000)
  if (value < 0) value = 0xffffffff + value + 1
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset] = (value >>> 24)
    this[offset + 1] = (value >>> 16)
    this[offset + 2] = (value >>> 8)
    this[offset + 3] = value
  } else {
    objectWriteUInt32(this, value, offset, false)
  }
  return offset + 4
}

function checkIEEE754 (buf, value, offset, ext, max, min) {
  if (value > max || value < min) throw new RangeError('value is out of bounds')
  if (offset + ext > buf.length) throw new RangeError('index out of range')
  if (offset < 0) throw new RangeError('index out of range')
}

function writeFloat (buf, value, offset, littleEndian, noAssert) {
  if (!noAssert) {
    checkIEEE754(buf, value, offset, 4, 3.4028234663852886e+38, -3.4028234663852886e+38)
  }
  ieee754.write(buf, value, offset, littleEndian, 23, 4)
  return offset + 4
}

Buffer.prototype.writeFloatLE = function writeFloatLE (value, offset, noAssert) {
  return writeFloat(this, value, offset, true, noAssert)
}

Buffer.prototype.writeFloatBE = function writeFloatBE (value, offset, noAssert) {
  return writeFloat(this, value, offset, false, noAssert)
}

function writeDouble (buf, value, offset, littleEndian, noAssert) {
  if (!noAssert) {
    checkIEEE754(buf, value, offset, 8, 1.7976931348623157E+308, -1.7976931348623157E+308)
  }
  ieee754.write(buf, value, offset, littleEndian, 52, 8)
  return offset + 8
}

Buffer.prototype.writeDoubleLE = function writeDoubleLE (value, offset, noAssert) {
  return writeDouble(this, value, offset, true, noAssert)
}

Buffer.prototype.writeDoubleBE = function writeDoubleBE (value, offset, noAssert) {
  return writeDouble(this, value, offset, false, noAssert)
}

// copy(targetBuffer, targetStart=0, sourceStart=0, sourceEnd=buffer.length)
Buffer.prototype.copy = function copy (target, targetStart, start, end) {
  if (!start) start = 0
  if (!end && end !== 0) end = this.length
  if (targetStart >= target.length) targetStart = target.length
  if (!targetStart) targetStart = 0
  if (end > 0 && end < start) end = start

  // Copy 0 bytes; we're done
  if (end === start) return 0
  if (target.length === 0 || this.length === 0) return 0

  // Fatal error conditions
  if (targetStart < 0) {
    throw new RangeError('targetStart out of bounds')
  }
  if (start < 0 || start >= this.length) throw new RangeError('sourceStart out of bounds')
  if (end < 0) throw new RangeError('sourceEnd out of bounds')

  // Are we oob?
  if (end > this.length) end = this.length
  if (target.length - targetStart < end - start) {
    end = target.length - targetStart + start
  }

  var len = end - start
  var i

  if (this === target && start < targetStart && targetStart < end) {
    // descending copy from end
    for (i = len - 1; i >= 0; i--) {
      target[i + targetStart] = this[i + start]
    }
  } else if (len < 1000 || !Buffer.TYPED_ARRAY_SUPPORT) {
    // ascending copy from start
    for (i = 0; i < len; i++) {
      target[i + targetStart] = this[i + start]
    }
  } else {
    target._set(this.subarray(start, start + len), targetStart)
  }

  return len
}

// fill(value, start=0, end=buffer.length)
Buffer.prototype.fill = function fill (value, start, end) {
  if (!value) value = 0
  if (!start) start = 0
  if (!end) end = this.length

  if (end < start) throw new RangeError('end < start')

  // Fill 0 bytes; we're done
  if (end === start) return
  if (this.length === 0) return

  if (start < 0 || start >= this.length) throw new RangeError('start out of bounds')
  if (end < 0 || end > this.length) throw new RangeError('end out of bounds')

  var i
  if (typeof value === 'number') {
    for (i = start; i < end; i++) {
      this[i] = value
    }
  } else {
    var bytes = utf8ToBytes(value.toString())
    var len = bytes.length
    for (i = start; i < end; i++) {
      this[i] = bytes[i % len]
    }
  }

  return this
}

/**
 * Creates a new `ArrayBuffer` with the *copied* memory of the buffer instance.
 * Added in Node 0.12. Only available in browsers that support ArrayBuffer.
 */
Buffer.prototype.toArrayBuffer = function toArrayBuffer () {
  if (typeof Uint8Array !== 'undefined') {
    if (Buffer.TYPED_ARRAY_SUPPORT) {
      return (new Buffer(this)).buffer
    } else {
      var buf = new Uint8Array(this.length)
      for (var i = 0, len = buf.length; i < len; i += 1) {
        buf[i] = this[i]
      }
      return buf.buffer
    }
  } else {
    throw new TypeError('Buffer.toArrayBuffer not supported in this browser')
  }
}

// HELPER FUNCTIONS
// ================

var BP = Buffer.prototype

/**
 * Augment a Uint8Array *instance* (not the Uint8Array class!) with Buffer methods
 */
Buffer._augment = function _augment (arr) {
  arr.constructor = Buffer
  arr._isBuffer = true

  // save reference to original Uint8Array set method before overwriting
  arr._set = arr.set

  // deprecated
  arr.get = BP.get
  arr.set = BP.set

  arr.write = BP.write
  arr.toString = BP.toString
  arr.toLocaleString = BP.toString
  arr.toJSON = BP.toJSON
  arr.equals = BP.equals
  arr.compare = BP.compare
  arr.indexOf = BP.indexOf
  arr.copy = BP.copy
  arr.slice = BP.slice
  arr.readUIntLE = BP.readUIntLE
  arr.readUIntBE = BP.readUIntBE
  arr.readUInt8 = BP.readUInt8
  arr.readUInt16LE = BP.readUInt16LE
  arr.readUInt16BE = BP.readUInt16BE
  arr.readUInt32LE = BP.readUInt32LE
  arr.readUInt32BE = BP.readUInt32BE
  arr.readIntLE = BP.readIntLE
  arr.readIntBE = BP.readIntBE
  arr.readInt8 = BP.readInt8
  arr.readInt16LE = BP.readInt16LE
  arr.readInt16BE = BP.readInt16BE
  arr.readInt32LE = BP.readInt32LE
  arr.readInt32BE = BP.readInt32BE
  arr.readFloatLE = BP.readFloatLE
  arr.readFloatBE = BP.readFloatBE
  arr.readDoubleLE = BP.readDoubleLE
  arr.readDoubleBE = BP.readDoubleBE
  arr.writeUInt8 = BP.writeUInt8
  arr.writeUIntLE = BP.writeUIntLE
  arr.writeUIntBE = BP.writeUIntBE
  arr.writeUInt16LE = BP.writeUInt16LE
  arr.writeUInt16BE = BP.writeUInt16BE
  arr.writeUInt32LE = BP.writeUInt32LE
  arr.writeUInt32BE = BP.writeUInt32BE
  arr.writeIntLE = BP.writeIntLE
  arr.writeIntBE = BP.writeIntBE
  arr.writeInt8 = BP.writeInt8
  arr.writeInt16LE = BP.writeInt16LE
  arr.writeInt16BE = BP.writeInt16BE
  arr.writeInt32LE = BP.writeInt32LE
  arr.writeInt32BE = BP.writeInt32BE
  arr.writeFloatLE = BP.writeFloatLE
  arr.writeFloatBE = BP.writeFloatBE
  arr.writeDoubleLE = BP.writeDoubleLE
  arr.writeDoubleBE = BP.writeDoubleBE
  arr.fill = BP.fill
  arr.inspect = BP.inspect
  arr.toArrayBuffer = BP.toArrayBuffer

  return arr
}

var INVALID_BASE64_RE = /[^+\/0-9A-Za-z-_]/g

function base64clean (str) {
  // Node strips out invalid characters like \n and \t from the string, base64-js does not
  str = stringtrim(str).replace(INVALID_BASE64_RE, '')
  // Node converts strings with length < 2 to ''
  if (str.length < 2) return ''
  // Node allows for non-padded base64 strings (missing trailing ===), base64-js does not
  while (str.length % 4 !== 0) {
    str = str + '='
  }
  return str
}

function stringtrim (str) {
  if (str.trim) return str.trim()
  return str.replace(/^\s+|\s+$/g, '')
}

function toHex (n) {
  if (n < 16) return '0' + n.toString(16)
  return n.toString(16)
}

function utf8ToBytes (string, units) {
  units = units || Infinity
  var codePoint
  var length = string.length
  var leadSurrogate = null
  var bytes = []

  for (var i = 0; i < length; i++) {
    codePoint = string.charCodeAt(i)

    // is surrogate component
    if (codePoint > 0xD7FF && codePoint < 0xE000) {
      // last char was a lead
      if (!leadSurrogate) {
        // no lead yet
        if (codePoint > 0xDBFF) {
          // unexpected trail
          if ((units -= 3) > -1) bytes.push(0xEF, 0xBF, 0xBD)
          continue

        } else if (i + 1 === length) {
          // unpaired lead
          if ((units -= 3) > -1) bytes.push(0xEF, 0xBF, 0xBD)
          continue
        }

        // valid lead
        leadSurrogate = codePoint

        continue
      }

      // 2 leads in a row
      if (codePoint < 0xDC00) {
        if ((units -= 3) > -1) bytes.push(0xEF, 0xBF, 0xBD)
        leadSurrogate = codePoint
        continue
      }

      // valid surrogate pair
      codePoint = leadSurrogate - 0xD800 << 10 | codePoint - 0xDC00 | 0x10000

    } else if (leadSurrogate) {
      // valid bmp char, but last char was a lead
      if ((units -= 3) > -1) bytes.push(0xEF, 0xBF, 0xBD)
    }

    leadSurrogate = null

    // encode utf8
    if (codePoint < 0x80) {
      if ((units -= 1) < 0) break
      bytes.push(codePoint)
    } else if (codePoint < 0x800) {
      if ((units -= 2) < 0) break
      bytes.push(
        codePoint >> 0x6 | 0xC0,
        codePoint & 0x3F | 0x80
      )
    } else if (codePoint < 0x10000) {
      if ((units -= 3) < 0) break
      bytes.push(
        codePoint >> 0xC | 0xE0,
        codePoint >> 0x6 & 0x3F | 0x80,
        codePoint & 0x3F | 0x80
      )
    } else if (codePoint < 0x110000) {
      if ((units -= 4) < 0) break
      bytes.push(
        codePoint >> 0x12 | 0xF0,
        codePoint >> 0xC & 0x3F | 0x80,
        codePoint >> 0x6 & 0x3F | 0x80,
        codePoint & 0x3F | 0x80
      )
    } else {
      throw new Error('Invalid code point')
    }
  }

  return bytes
}

function asciiToBytes (str) {
  var byteArray = []
  for (var i = 0; i < str.length; i++) {
    // Node's code seems to be doing this and not & 0x7F..
    byteArray.push(str.charCodeAt(i) & 0xFF)
  }
  return byteArray
}

function utf16leToBytes (str, units) {
  var c, hi, lo
  var byteArray = []
  for (var i = 0; i < str.length; i++) {
    if ((units -= 2) < 0) break

    c = str.charCodeAt(i)
    hi = c >> 8
    lo = c % 256
    byteArray.push(lo)
    byteArray.push(hi)
  }

  return byteArray
}

function base64ToBytes (str) {
  return base64.toByteArray(base64clean(str))
}

function blitBuffer (src, dst, offset, length) {
  for (var i = 0; i < length; i++) {
    if ((i + offset >= dst.length) || (i >= src.length)) break
    dst[i + offset] = src[i]
  }
  return i
}

},{"base64-js":2,"ieee754":3,"is-array":4}],2:[function(require,module,exports){
var lookup = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

;(function (exports) {
	'use strict';

  var Arr = (typeof Uint8Array !== 'undefined')
    ? Uint8Array
    : Array

	var PLUS   = '+'.charCodeAt(0)
	var SLASH  = '/'.charCodeAt(0)
	var NUMBER = '0'.charCodeAt(0)
	var LOWER  = 'a'.charCodeAt(0)
	var UPPER  = 'A'.charCodeAt(0)
	var PLUS_URL_SAFE = '-'.charCodeAt(0)
	var SLASH_URL_SAFE = '_'.charCodeAt(0)

	function decode (elt) {
		var code = elt.charCodeAt(0)
		if (code === PLUS ||
		    code === PLUS_URL_SAFE)
			return 62 // '+'
		if (code === SLASH ||
		    code === SLASH_URL_SAFE)
			return 63 // '/'
		if (code < NUMBER)
			return -1 //no match
		if (code < NUMBER + 10)
			return code - NUMBER + 26 + 26
		if (code < UPPER + 26)
			return code - UPPER
		if (code < LOWER + 26)
			return code - LOWER + 26
	}

	function b64ToByteArray (b64) {
		var i, j, l, tmp, placeHolders, arr

		if (b64.length % 4 > 0) {
			throw new Error('Invalid string. Length must be a multiple of 4')
		}

		// the number of equal signs (place holders)
		// if there are two placeholders, than the two characters before it
		// represent one byte
		// if there is only one, then the three characters before it represent 2 bytes
		// this is just a cheap hack to not do indexOf twice
		var len = b64.length
		placeHolders = '=' === b64.charAt(len - 2) ? 2 : '=' === b64.charAt(len - 1) ? 1 : 0

		// base64 is 4/3 + up to two characters of the original data
		arr = new Arr(b64.length * 3 / 4 - placeHolders)

		// if there are placeholders, only get up to the last complete 4 chars
		l = placeHolders > 0 ? b64.length - 4 : b64.length

		var L = 0

		function push (v) {
			arr[L++] = v
		}

		for (i = 0, j = 0; i < l; i += 4, j += 3) {
			tmp = (decode(b64.charAt(i)) << 18) | (decode(b64.charAt(i + 1)) << 12) | (decode(b64.charAt(i + 2)) << 6) | decode(b64.charAt(i + 3))
			push((tmp & 0xFF0000) >> 16)
			push((tmp & 0xFF00) >> 8)
			push(tmp & 0xFF)
		}

		if (placeHolders === 2) {
			tmp = (decode(b64.charAt(i)) << 2) | (decode(b64.charAt(i + 1)) >> 4)
			push(tmp & 0xFF)
		} else if (placeHolders === 1) {
			tmp = (decode(b64.charAt(i)) << 10) | (decode(b64.charAt(i + 1)) << 4) | (decode(b64.charAt(i + 2)) >> 2)
			push((tmp >> 8) & 0xFF)
			push(tmp & 0xFF)
		}

		return arr
	}

	function uint8ToBase64 (uint8) {
		var i,
			extraBytes = uint8.length % 3, // if we have 1 byte left, pad 2 bytes
			output = "",
			temp, length

		function encode (num) {
			return lookup.charAt(num)
		}

		function tripletToBase64 (num) {
			return encode(num >> 18 & 0x3F) + encode(num >> 12 & 0x3F) + encode(num >> 6 & 0x3F) + encode(num & 0x3F)
		}

		// go through the array every three bytes, we'll deal with trailing stuff later
		for (i = 0, length = uint8.length - extraBytes; i < length; i += 3) {
			temp = (uint8[i] << 16) + (uint8[i + 1] << 8) + (uint8[i + 2])
			output += tripletToBase64(temp)
		}

		// pad the end with zeros, but make sure to not forget the extra bytes
		switch (extraBytes) {
			case 1:
				temp = uint8[uint8.length - 1]
				output += encode(temp >> 2)
				output += encode((temp << 4) & 0x3F)
				output += '=='
				break
			case 2:
				temp = (uint8[uint8.length - 2] << 8) + (uint8[uint8.length - 1])
				output += encode(temp >> 10)
				output += encode((temp >> 4) & 0x3F)
				output += encode((temp << 2) & 0x3F)
				output += '='
				break
		}

		return output
	}

	exports.toByteArray = b64ToByteArray
	exports.fromByteArray = uint8ToBase64
}(typeof exports === 'undefined' ? (this.base64js = {}) : exports))

},{}],3:[function(require,module,exports){
exports.read = function (buffer, offset, isLE, mLen, nBytes) {
  var e, m
  var eLen = nBytes * 8 - mLen - 1
  var eMax = (1 << eLen) - 1
  var eBias = eMax >> 1
  var nBits = -7
  var i = isLE ? (nBytes - 1) : 0
  var d = isLE ? -1 : 1
  var s = buffer[offset + i]

  i += d

  e = s & ((1 << (-nBits)) - 1)
  s >>= (-nBits)
  nBits += eLen
  for (; nBits > 0; e = e * 256 + buffer[offset + i], i += d, nBits -= 8) {}

  m = e & ((1 << (-nBits)) - 1)
  e >>= (-nBits)
  nBits += mLen
  for (; nBits > 0; m = m * 256 + buffer[offset + i], i += d, nBits -= 8) {}

  if (e === 0) {
    e = 1 - eBias
  } else if (e === eMax) {
    return m ? NaN : ((s ? -1 : 1) * Infinity)
  } else {
    m = m + Math.pow(2, mLen)
    e = e - eBias
  }
  return (s ? -1 : 1) * m * Math.pow(2, e - mLen)
}

exports.write = function (buffer, value, offset, isLE, mLen, nBytes) {
  var e, m, c
  var eLen = nBytes * 8 - mLen - 1
  var eMax = (1 << eLen) - 1
  var eBias = eMax >> 1
  var rt = (mLen === 23 ? Math.pow(2, -24) - Math.pow(2, -77) : 0)
  var i = isLE ? 0 : (nBytes - 1)
  var d = isLE ? 1 : -1
  var s = value < 0 || (value === 0 && 1 / value < 0) ? 1 : 0

  value = Math.abs(value)

  if (isNaN(value) || value === Infinity) {
    m = isNaN(value) ? 1 : 0
    e = eMax
  } else {
    e = Math.floor(Math.log(value) / Math.LN2)
    if (value * (c = Math.pow(2, -e)) < 1) {
      e--
      c *= 2
    }
    if (e + eBias >= 1) {
      value += rt / c
    } else {
      value += rt * Math.pow(2, 1 - eBias)
    }
    if (value * c >= 2) {
      e++
      c /= 2
    }

    if (e + eBias >= eMax) {
      m = 0
      e = eMax
    } else if (e + eBias >= 1) {
      m = (value * c - 1) * Math.pow(2, mLen)
      e = e + eBias
    } else {
      m = value * Math.pow(2, eBias - 1) * Math.pow(2, mLen)
      e = 0
    }
  }

  for (; mLen >= 8; buffer[offset + i] = m & 0xff, i += d, m /= 256, mLen -= 8) {}

  e = (e << mLen) | m
  eLen += mLen
  for (; eLen > 0; buffer[offset + i] = e & 0xff, i += d, e /= 256, eLen -= 8) {}

  buffer[offset + i - d] |= s * 128
}

},{}],4:[function(require,module,exports){

/**
 * isArray
 */

var isArray = Array.isArray;

/**
 * toString
 */

var str = Object.prototype.toString;

/**
 * Whether or not the given `val`
 * is an array.
 *
 * example:
 *
 *        isArray([]);
 *        // > true
 *        isArray(arguments);
 *        // > false
 *        isArray('');
 *        // > false
 *
 * @param {mixed} val
 * @return {bool}
 */

module.exports = isArray || function (val) {
  return !! val && '[object Array]' == str.call(val);
};

},{}],5:[function(require,module,exports){
/**
 * Epicenter Javascript libraries
 * v1.4.0
 * https://github.com/forio/epicenter-js-libs
 */

var F = {
    util: {},
    factory: {},
    transport: {},
    store: {},
    service: {},
    manager: {
        strategy: {}
    },

};

F.util.query = require('./util/query-util');
F.util.makeSequence = require('./util/make-sequence');
F.util.run = require('./util/run-util');
F.util.classFrom = require('./util/inherit');

F.factory.Transport = require('./transport/http-transport-factory');
F.transport.Ajax = require('./transport/ajax-http-transport');

F.service.URL = require('./service/url-config-service');
F.service.Config = require('./service/configuration-service');
F.service.Run = require('./service/run-api-service');
F.service.Variables = require('./service/variables-api-service');
F.service.Data = require('./service/data-api-service');
F.service.Auth = require('./service/auth-api-service');
F.service.World = require('./service/world-api-adapter');
F.service.State = require('./service/state-api-adapter');
F.service.User = require('./service/user-api-adapter');
F.service.Member = require('./service/member-api-adapter');

F.store.Cookie = require('./store/cookie-store');
F.factory.Store = require('./store/store-factory');

F.manager.ScenarioManager = require('./managers/scenario-manager');
F.manager.RunManager = require('./managers/run-manager');
F.manager.AuthManager = require('./managers/auth-manager');
F.manager.WorldManager = require('./managers/world-manager');

F.manager.strategy['always-new'] = require('./managers/run-strategies/always-new-strategy');
F.manager.strategy['conditional-creation'] = require('./managers/run-strategies/conditional-creation-strategy');
F.manager.strategy.identity = require('./managers/run-strategies/identity-strategy');
F.manager.strategy['new-if-missing'] = require('./managers/run-strategies/new-if-missing-strategy');
F.manager.strategy['new-if-missing'] = require('./managers/run-strategies/new-if-missing-strategy');
F.manager.strategy['new-if-persisted'] = require('./managers/run-strategies/new-if-persisted-strategy');
F.manager.strategy['new-if-initialized'] = require('./managers/run-strategies/new-if-initialized-strategy');

F.manager.ChannelManager = require('./managers/epicenter-channel-manager');
F.service.Channel = require('./service/channel-service');

F.version = '1.4.0';
window.F = F;


},{"./managers/auth-manager":6,"./managers/epicenter-channel-manager":8,"./managers/run-manager":10,"./managers/run-strategies/always-new-strategy":11,"./managers/run-strategies/conditional-creation-strategy":13,"./managers/run-strategies/identity-strategy":14,"./managers/run-strategies/new-if-initialized-strategy":16,"./managers/run-strategies/new-if-missing-strategy":17,"./managers/run-strategies/new-if-persisted-strategy":18,"./managers/scenario-manager":21,"./managers/world-manager":23,"./service/auth-api-service":24,"./service/channel-service":25,"./service/configuration-service":26,"./service/data-api-service":27,"./service/member-api-adapter":28,"./service/run-api-service":29,"./service/state-api-adapter":30,"./service/url-config-service":31,"./service/user-api-adapter":32,"./service/variables-api-service":33,"./service/world-api-adapter":34,"./store/cookie-store":35,"./store/store-factory":36,"./transport/ajax-http-transport":37,"./transport/http-transport-factory":38,"./util/inherit":39,"./util/make-sequence":40,"./util/query-util":42,"./util/run-util":43}],6:[function(require,module,exports){
/**
* ## Authorization Manager
*
* The Authorization Manager provides an easy way to manage user authentication (logging in and out) and authorization (keeping track of tokens, sessions, and groups) for projects.
*
* The Authorization Manager is most useful for [team projects](../../../glossary/#team) with an access level of [Authenticated](../../../glossary/#access). These projects are accessed by [end users](../../../glossary/#users) who are members of one or more [groups](../../../glossary/#groups).
*
* ####Using the Authorization Manager
*
* To use the Authorization Manager, instantiate it. Then, make calls to any of the methods you need:
*
*       var authMgr = new F.manager.AuthManager({
*           account: 'acme-simulations',
*           userName: 'enduser1',
*           password: 'passw0rd'
*       });
*       authMgr.login();
*       authMgr.getCurrentUserSessionInfo();
*
* The `options` object passed to the `F.manager.AuthManager()` call can include:
*
*   * `account`: The account id for this `userName`. In the Epicenter UI, this is the **Team ID** (for team projects) or the **User ID** (for personal projects).
*   * `userName`: Email or username to use for logging in.
*   * `password`: Password for specified `userName`.
*   * `project`: The **Project ID** for the project to log this user into. Optional.
*   * `group`: Name of the group to which `userName` belongs. Required for end users if the `project` is specified.
*
* If you prefer starting from a template, the Epicenter JS Libs [Login Component](../../#components) uses the Authorization Manager as well. This sample HTML page (and associated CSS and JS files) provides a login form for team members and end users of your project. It also includes a group selector for end users that are members of multiple groups.
*/

'use strict';
var ConfigService = require('../service/configuration-service');
var AuthAdapter = require('../service/auth-api-service');
var MemberAdapter = require('../service/member-api-adapter');
var StorageFactory = require('../store/store-factory');
var Buffer = require('buffer').Buffer;
var keyNames = require('./key-names');

var defaults = {
    /**
     * Where to store user access tokens for temporary access. Defaults to storing in a cookie in the browser.
     * @type {string}
     */
    store: { synchronous: true }
};

var EPI_COOKIE_KEY = keyNames.EPI_COOKIE_KEY;
var EPI_SESSION_KEY = keyNames.EPI_SESSION_KEY;
var store;
var token;
var session;

function saveSession(userInfo) {
    var serialized = JSON.stringify(userInfo);
    store.set(EPI_SESSION_KEY, serialized);

    //jshint camelcase: false
    //jscs:disable
    store.set(EPI_COOKIE_KEY, userInfo.auth_token);
}

function getSession() {
    var session = store.get(EPI_SESSION_KEY) || '{}';
    return JSON.parse(session);
}

function AuthManager(options) {
    this.options = $.extend(true, {}, defaults, options);

    var urlConfig = new ConfigService(this.options).get('server');
    if (!this.options.account) {
        this.options.account = urlConfig.accountPath;
    }

    // null might specified to disable project filtering
    if (this.options.project === undefined) {
        this.options.project = urlConfig.projectPath;
    }

    store = new StorageFactory(this.options.store);
    session = getSession();
    token = store.get(EPI_COOKIE_KEY) || '';
    //jshint camelcase: false
    //jscs:disable
    this.authAdapter = new AuthAdapter(this.options, { token: session.auth_token });
}

var _findUserInGroup = function (members, id) {
    for (var j = 0; j<members.length; j++) {
        if (members[j].userId === id) {
            return members[j];
        }
    }


    return null;
};

AuthManager.prototype = $.extend(AuthManager.prototype, {

    /**
    * Logs user in.
    *
    * **Example**
    *
    *       authMgr.login({
    *           account: 'acme-simulations', 
    *           userName: 'enduser1', 
    *           password: 'passw0rd' 
    *       });
    *
    *       authMgr.login()
    *           .then(function(authAdapter) {
    *               // if enduser1 belongs to exactly one group
    *               // (or if the login() call is modified to include the group)
    *               // continue here
    *           })
    *           .fail(function(authAdapter) {
    *               // if enduser1 belongs to multiple groups, 
    *               // the login() call fails 
    *               // and returns all groups of which the user is a member
    *           });
    *
    * **Parameters**
    *
    * @param {Object} `options` (Optional) Overrides for configuration options. If not passed in when creating an instance of the manager (`F.manager.AuthManager()`), these options should include: 
    * @param {string} `options.account` The account id for this `userName`. In the Epicenter UI, this is the **Team ID** (for team projects) or the **User ID** (for personal projects).
    * @param {string} `options.userName` Email or username to use for logging in.
    * @param {string} `options.password` Password for specified `userName`.
    * @param {string} `options.project` (Optional) The **Project ID** for the project to log this user into.
    * @param {string} `options.group` Name of the group to which `userName` belongs. Required for [end users](../../../glossary/#users) if the `project` is specified, and for end users that are members of multiple [groups](../../../glossary/#groups), otherwise optional.
    */
    login: function (options) {
        var _this = this;
        var $d = $.Deferred();
        var adapterOptions = $.extend(true, { success: $.noop, error: $.noop }, this.options, options);
        var outSuccess = adapterOptions.success;
        var outError = adapterOptions.error;
        var groupId = adapterOptions.groupId;

        var decodeToken = function (token) {
            var encoded = token.split('.')[1];
            while (encoded.length % 4 !== 0) {
                encoded += '=';
            }

            var decode = window.atob ? window.atob : function (encoded) { return new Buffer(encoded, 'base64').toString('ascii'); };

            return JSON.parse(decode(encoded));
        };

        var handleGroupError = function (message, statusCode, data) {
            // logout the user since it's in an invalid state with no group selected
            _this.logout().then(function () {
                var error = $.extend(true, {}, data, { statusText: message, status: statusCode });
                $d.reject(error);
            });
        };

        var handleSuccess = function (response) {
            //jshint camelcase: false
            //jscs:disable
            token = response.access_token;

            var userInfo = decodeToken(token);
            var userGroupOpts = $.extend(true, {}, adapterOptions, { success: $.noop, token: token });
            _this.getUserGroups({ userId: userInfo.user_id, token: token }, userGroupOpts).done( function (memberInfo) {
                var data = {auth: response, user: userInfo, userGroups: memberInfo, groupSelection: {} };

                var sessionInfo = {
                    'auth_token': token,
                    'account': adapterOptions.account,
                    'project': adapterOptions.project,
                    'userId': userInfo.user_id
                };
                // The group is not required if the user is not logging into a project
                if (!adapterOptions.project) {
                    saveSession(sessionInfo);
                    outSuccess.apply(this, [data]);
                    $d.resolve(data);
                    return;
                }

                var group = null;
                if (memberInfo.length === 0) {
                    handleGroupError('The user has no groups associated in this account', 401, data);
                    return;
                } else if (memberInfo.length === 1) {
                    // Select the only group
                    group = memberInfo[0];
                } else if (memberInfo.length > 1) {
                    if (groupId) {
                        var filteredGroups = $.grep(memberInfo, function (resGroup) {
                            return resGroup.groupId === groupId;
                        });
                        group = filteredGroups.length === 1 ? filteredGroups[0] : null;
                    }
                }

                if (group) {
                    var groupSelection = group.groupId;
                    data.groupSelection[adapterOptions.project] = groupSelection;
                    var sessionInfoWithGroup = $.extend({}, sessionInfo, {
                        'groupId': group.groupId,
                        'groupName': group.name,
                        'isFac': _findUserInGroup(group.members, userInfo.user_id).role === 'facilitator'
                    });
                    saveSession(sessionInfoWithGroup);
                    outSuccess.apply(this, [data]);
                    $d.resolve(data);
                } else {
                    handleGroupError('This account is associated with more that one group. Please specify a group id to log into and try again', 403, data);
                }
            }).fail($d.reject);
        };

        adapterOptions.success = handleSuccess;
        adapterOptions.error = function (response) {
            if (adapterOptions.account) {
                // Try to login as a system user
                adapterOptions.account = null;
                adapterOptions.error = function () {
                    outError.apply(this, arguments);
                    $d.reject(response);
                };

                _this.authAdapter.login(adapterOptions);
                return;
            }

            outError.apply(this, arguments);
            $d.reject(response);
        };

        this.authAdapter.login(adapterOptions);
        return $d.promise();
    },

    /**
    * Logs user out.
    *
    * **Example**
    *
    *       authMgr.logout();
    *
    * **Parameters**
    *
    * @param {Object} `options` (Optional) Overrides for configuration options.
    */
    logout: function (options) {
        var $d = $.Deferred();
        var adapterOptions = $.extend(true, {success: $.noop, token: token }, this.options, options);

        var removeCookieFn = function (response) {
            store.remove(EPI_COOKIE_KEY, adapterOptions);
            store.remove(EPI_SESSION_KEY, adapterOptions);
            token = '';
        };

        var outSuccess = adapterOptions.success;
        adapterOptions.success = function (response) {
            removeCookieFn(response);
            outSuccess.apply(this, arguments);
        };

        // Epicenter returns a bad request when trying to delete a token. It seems like the API call is not implemented yet
        // Once it's implemented this error handler should not be necessary.
        adapterOptions.error = function (response) {
            removeCookieFn(response);
            outSuccess.apply(this, arguments);
            $d.resolve();
        };

        this.authAdapter.logout(adapterOptions).done($d.resolve);
        return $d.promise();
    },

    /**
     * Returns the existing user access token if the user is already logged in. Otherwise, logs the user in, creating a new user access token, and returns the new token. (See [more background on access tokens](../../../project_access/)).
     *
     * **Example**
     *
     *      authMgr.getToken()
     *          .then(function (token) { 
     *              console.log('My token is ', token); 
     *          });
     *
     * **Parameters**
     * @param {Object} `options` (Optional) Overrides for configuration options.
     */
    getToken: function (options) {
        var httpOptions = $.extend(true, this.options, options);

        var $d = $.Deferred();
        if (token) {
            $d.resolve(token);
        } else {
            this.login(httpOptions).then($d.resolve);
        }
        return $d.promise();
    },

    /**
     * Returns an array of group records, one for each group of which the current user is a member. Each group record includes the group `name`, `account`, `project`, and `groupId`.
     *
     * If some end users in your project are members of multiple groups, this is a useful method to call on your project's login page. When the user attempts to log in, you can use this to display the groups of which the user is member, and have the user select the correct group to log in to for this session.
     *
     * **Example**
     *
     *      // get groups for current user
     *      authMgr.getUserGroups()
     *          .then(function (groups) { 
     *              for (var i=0; i < groups.length; i++) 
     *                  { console.log(groups[i].name); }
     *          });
     *
     *      // get groups for particular user
     *      authMgr.getUserGroups({userId: 'b1c19dda-2d2e-4777-ad5d-3929f17e86d3'});
     *
     * **Parameters**
     * @param {Object} `params` (Optional) Object with a userId and token properties.
     * @param {Object} `options` (Optional) Overrides for configuration options.
     */
    getUserGroups: function (params, options) {
        var adapterOptions = $.extend(true, { success: $.noop }, this.options, options);
        var $d = $.Deferred();
        var outSuccess = adapterOptions.success;

        adapterOptions.success = function (memberInfo) {
            // The member API is at the account scope, we filter by project
            if (adapterOptions.project) {
                memberInfo = $.grep(memberInfo, function (group) {
                    return group.project === adapterOptions.project;
                });
            }

            outSuccess.apply(this, [memberInfo]);
            $d.resolve(memberInfo);
        };

        var memberAdapter = new MemberAdapter({ token: params.token });
        memberAdapter.getGroupsByUser(params, adapterOptions).fail($d.reject);
        return $d.promise();
    },

    /**
     * Returns session information for the current user, including the `userId`, `account`, `project`, `groupId`, `groupName`, `isFac` (whether the end user is a facilitator of this group), and `auth_token` (user access token).
     *
     * *Important*: This method is synchronous. The session information is returned immediately in an object; no callbacks or promises are needed.
     *
     * By default, session information is stored in a cookie in the browser. You can change this with the `store` configuration option. 
     *
     * **Example**
     *
     *      var sessionObj = authMgr.getCurrentUserSessionInfo();
     *
     * **Parameters**
     * @param {Object} `options` (Optional) Overrides for configuration options.
     */
    getCurrentUserSessionInfo: function (options) {
        return getSession(options);
    }
});

module.exports = AuthManager;

},{"../service/auth-api-service":24,"../service/configuration-service":26,"../service/member-api-adapter":28,"../store/store-factory":36,"./key-names":9,"buffer":1}],7:[function(require,module,exports){
'use strict';

var Channel = require('../service/channel-service');

/**
 * ## Channel Manager
 *
 * There are two main use cases for the channel: event notifications and chat messages.
 *
 * The Channel Manager is a wrapper around the default [cometd JavaScript library](http://docs.cometd.org/2/reference/javascript.html), `$.cometd`. It provides a few nice features that `$.cometd` doesn't, including:
 *
 * * Automatic re-subscription to channels if you lose your connection
 * * Online / Offline notifications
 * * 'Events' for cometd notifications (instead of having to listen on specific meta channels)
 *
 * While you can work directly with the Channel Manager through Node.js (for example, `require('manager/channel-manager')`) -- or even work directly with `$.cometd` and Epicenter's underlying [Push Channel API](../../../rest_apis/multiplayer/channel/) -- most often it will be easiest to work with the [Epicenter Channel Manager](../epicenter-channel-manager/). The Epicenter Channel Manager is a wrapper that instantiates a Channel Manager with Epicenter-specific defaults.
 *
 * You'll need to include the `epicenter-multiplayer-dependencies.js` library in addition to the `epicenter.js` library in your project to use the Channel Manager. (See [Including Epicenter.js](../../#include).)
 *
 * To use the Channel Manager in client-side JavaScript, instantiate the [Epicenter Channel Manager](../epicenter-channel-manager/), get the channel, then use the channel's `subscribe()` and `publish()` methods to subscribe to topics or publish data to topics.
 *
 *        var cm = new F.manager.ChannelManager();
 *        var channel = cm.getChannel();
 *        channel.subscribe(topic);
 *
 * The parameters for instantiating a Channel Manager include:
 *
 * * `options` The options object to configure the Channel Manager. Besides the common options listed here, see http://docs.cometd.org/reference/javascript.html for other supported options.
 * * `options.url` The Cometd endpoint URL.
 * * `options.websocketEnabled` Whether websocket support is active (boolean).
 * * `options.channel` Other defaults to pass on to instances of the underlying Channel Service. See [Channel Service](../channel-service/) for details.
 *
 */
var ChannelManager = function (options) {
    if (!$.cometd) {
        throw new Error('Cometd library not found. Please include epicenter-multiplayer-dependencies.js');
    }
    if (!options || !options.url) {
        throw new Error('Please provide an url for the cometd server');
    }

    var cometd = new $.Cometd();

    var defaults = {
        /**
         * The Cometd endpoint URL.
         */
        url: '',

        /**
         * The log level for the channel (logs to console).
         */
        logLevel: 'info',

        /**
         * Whether websocket support is active. Defaults to `false`; Epicenter doesn't currently communication through websockets.
         */
        websocketEnabled: false,

        /**
         * Other defaults to pass on to instances of the underlying [Channel Service](../channel-service/), which are created through `getChannel()`.
         */
        channel: {

        }
    };
    var defaultCometOptions = $.extend(true, {}, defaults, options);

    cometd.websocketEnabled = defaultCometOptions.websocketEnabled;

    this.isConnected = false;
    this.currentSubscriptions = [];
    this.options = defaultCometOptions;

    var connectionBroken = function (message) {
        $(this).trigger('disconnect', message);
    };
    var connectionSucceeded = function (message) {
        $(this).trigger('connect', message);
    };
    var me = this;

    cometd.configure(defaultCometOptions);

    cometd.addListener('/meta/connect', function (message) {
        var wasConnected = this.isConnected;
        this.isConnected = (message.successful === true);
        if (!wasConnected && this.isConnected) { //Connecting for the first time
            connectionSucceeded.call(this, message);
        } else if (wasConnected && !this.isConnected) { //Only throw disconnected message fro the first disconnect, not once per try
            connectionBroken.call(this, message);
        }
    }.bind(this));

    cometd.addListener('/meta/disconnect', connectionBroken);

    cometd.addListener('/meta/handshake', function (message) {
        if (message.successful) {
            //http://docs.cometd.org/reference/javascript_subscribe.html#javascript_subscribe_meta_channels
            // ^ "dynamic subscriptions are cleared (like any other subscription) and the application needs to figure out which dynamic subscription must be performed again"
            cometd.batch(function () {
                $(me.currentSubscriptions).each(function (index, subs) {
                    cometd.resubscribe(subs);
                });
            });
        }
    });

    //Other interesting events for reference
    cometd.addListener('/meta/subscribe', function (message) {
        $(me).trigger('subscribe', message);
    });
    cometd.addListener('/meta/unsubscribe', function (message) {
        $(me).trigger('unsubscribe', message);
    });
    cometd.addListener('/meta/publish', function (message) {
        $(me).trigger('publish', message);
    });
    cometd.addListener('/meta/unsuccessful', function (message) {
        $(me).trigger('error', message);
    });

    cometd.handshake();

    this.cometd = cometd;
};


ChannelManager.prototype = $.extend(ChannelManager.prototype, {

    /**
     * Creates and returns a channel, that is, an instance of a [Channel Service](../channel-service/).
     *
     * **Example**
     *
     *      var cm = new F.manager.ChannelManager();
     *      var channel = cm.getChannel();
     *      channel.subscribe(topic);
     *
     * **Parameters**
     * @param {None} None
     */
    getChannel: function (options) {
        //If you just want to pass in a string
        if (options && !$.isPlainObject(options)) {
            options = {
                base: options
            };
        }
        var defaults = {
            transport: this.cometd
        };
        var channel = new Channel($.extend(true, {}, this.options.channel, defaults, options));


        //Wrap subs and unsubs so we can use it to re-attach handlers after being disconnected
        var subs = channel.subscribe;
        channel.subscribe = function () {
            var subid = subs.apply(channel, arguments);
            this.currentSubscriptions  = this.currentSubscriptions.concat(subid);
            return subid;
        }.bind(this);


        var unsubs = channel.unsubscribe;
        channel.unsubscribe = function () {
            var removed = unsubs.apply(channel, arguments);
            for (var i = 0; i < this.currentSubscriptions.length; i++) {
                if (this.currentSubscriptions[i].id === removed.id) {
                    this.currentSubscriptions.splice(i, 1);
                }
            }
            return removed;
        }.bind(this);

        return channel;
    },

    /**
     * Start listening for events on this instance. Signature is same as for jQuery Events: http://api.jquery.com/on/.
     *
     * Supported events are: `connect`, `disconnect`, `subscribe`, `unsubscribe`, `publish`, `error`.
     *
     * **Parameters**
     *
     * @param {string} `event` The event type. See more detail at jQuery Events: http://api.jquery.com/on/.
     */
    on: function () {
        $(this).on.apply($(this), arguments);
    },

    /**
     * Stop listening for events on this instance. Signature is same as for jQuery Events: http://api.jquery.com/off/.
     *
     * **Parameters**
     *
     * @param {string} `event` The event type. See more detail at jQuery Events: http://api.jquery.com/off/.
     */
    off: function () {
        $(this).off.apply($(this), arguments);
    },

    /**
     * Trigger events and execute handlers. Signature is same as for jQuery Events: http://api.jquery.com/trigger/.
     *
     * **Parameters**
     *
     * @param {string} `event` The event type. See more detail at jQuery Events: http://api.jquery.com/trigger/.
     */
    trigger: function () {
        $(this).trigger.apply($(this), arguments);
    }
});

module.exports = ChannelManager;

},{"../service/channel-service":25}],8:[function(require,module,exports){
'use strict';

/**
 * ## Epicenter Channel Manager
 *
 * The Epicenter platform provides a push channel, which allows you to publish and subscribe to messages within a [project](../../../glossary/#projects), [group](../../../glossary/#groups), or [multiplayer world](../../../glossary/#world). There are two main use cases for the channel: event notifications and chat messages.
 *
 * The Epicenter Channel Manager is a wrapper around the (more generic) [Channel Manager](../channel-manager/), to instantiate it with Epicenter-specific defaults. If you are interested in including a notification or chat feature in your project, using an Epicenter Channel Manager is probably the easiest way to get started.
 *
 * You'll need to include the `epicenter-multiplayer-dependencies.js` library in addition to the `epicenter.js` library in your project to use the Epicenter Channel Manager. (See [Including Epicenter.js](../../#include).)
 *
 * To use the Epicenter Channel Manager: instantiate it, get the channel of the scope you want ([user](../../../glossary/#users), [world](../../../glossary/#world), or [group](../../../glossary/#groups)), then use the channel's `subscribe()` and `publish()` methods to subscribe to topics or publish data to topics.
 *
 *     var cm = new F.manager.ChannelManager();
 *     var gc = cm.getGroupChannel();
 *     gc.subscribe('broadcasts', callback);
 *
 * For additional background on Epicenter's push channel, see the introductory notes on the [Push Channel API](../../../rest_apis/multiplayer/channel/) page.
 *
 * The parameters for instantiating an Epicenter Channel Manager include:
 *
 * * `server` Object with details about the Epicenter project for this Epicenter Channel Manager instance.
 * * `server.account` The Epicenter account id (**Team ID** for team projects, **User ID** for personal projects).
 * * `server.project` Epicenter project id.
 */

var ChannelManager = require('./channel-manager');
var classFrom = require('../util/inherit');
var urlService = require('../service/url-config-service');

var AuthManager = require('./auth-manager');

var session = new AuthManager();
var getFromSessionOrError = function (value, sessionKeyName) {
    if (!value) {
        var userInfo = session.getCurrentUserSessionInfo();
        if (userInfo[sessionKeyName]) {
            value = userInfo[sessionKeyName];
        } else {
            throw new Error(sessionKeyName + ' not found. Please log-in again, or specify ' + sessionKeyName + ' explicitly');
        }
    }
    return value;
};
var __super = ChannelManager.prototype;
var EpicenterChannelManager = classFrom(ChannelManager, {
    constructor: function (options) {
        var userInfo = session.getCurrentUserSessionInfo();

        var defaults = {
            //See docs for url config service
            server: {
                account: userInfo.account,
                project: userInfo.project
            }
        };
        var defaultCometOptions = $.extend(true, {}, defaults, userInfo, options);

        var urlOpts = urlService(defaultCometOptions.server);
        if (!defaultCometOptions.url) {
            //Default epicenter cometd endpoint
            defaultCometOptions.url = urlOpts.protocol + '://' + urlOpts.host + '/channel/subscribe';
        }

        this.options = defaultCometOptions;
        return __super.constructor.call(this, defaultCometOptions);
    },

    /**
     * Create and return a publish/subscribe channel (from the underlying [Channel Manager](../channel-manager/)) for the given [group](../../../glossary/#groups). The group must be one of the groups in this account (team) and project.
     *
     * There are no notifications from Epicenter on this channel; all messages are user-orginated.
     *
     * **Example**
     *
     *     var cm = new F.manager.ChannelManager();
     *     var gc = cm.getGroupChannel();
     *     gc.subscribe('broadcasts', callback);
     *
     * **Return Value**
     *
     * * *Channel* Returns the channel (an instance of the [Channel Service](../channel-service/)).
     *
     * **Parameters**
     *
     * @param  {String} `groupName` (Optional) Group to broadcast to. If not provided, picks up group from current session if end user is logged in.
     */
    getGroupChannel: function (groupName) {
        groupName = getFromSessionOrError(groupName, 'groupName');
        var baseTopic = ['/group', this.options.server.account, this.options.server.project, groupName].join('/');
        return __super.getChannel.call(this, { base: baseTopic });
    },

    /**
     * Create and return a publish/subscribe channel (from the underlying [Channel Manager](../channel-manager/)) for the given [world](../../../glossary/#world).
     *
     * This is typically used together with the [World Manager](../world-manager).
     *
     * **Example**
     *
     *     var cm = new F.manager.ChannelManager();
     *     var worldManager = new F.manager.WorldManager({
     *         account: 'acme-simulations',
     *         project: 'supply-chain-game',
     *         model: 'model.eqn'
     *     });
     *     worldManager.getCurrentWorld().then(function (worldObject, worldService) {
     *         var worldChannel = cm.getWorldChannel(worldObject);
     *         worldChannel.subscribe('', function (data) {
     *             console.log(data);
     *         });
     *      });
     *
     * **Return Value**
     *
     * * *Channel* Returns the channel (an instance of the [Channel Service](../channel-service/)).
     *
     * **Parameters**
     *
     * @param  {String|Object} `world` The world object or id.
     * @param  {String} `groupName` (Optional) Group the world exists in. If not provided, picks up group from current session if end user is logged in.
     */
    getWorldChannel: function (world, groupName) {
        var worldid = ($.isPlainObject(world) && world.id) ? world.id : world;
        if (!worldid) {
            throw new Error('Please specify a world id');
        }
        groupName = getFromSessionOrError(groupName, 'groupName');
        var baseTopic = ['/world', this.options.server.account, this.options.server.project, groupName, worldid].join('/');
        return __super.getChannel.call(this, { base: baseTopic });
    },

    /**
     * Create and return a publish/subscribe channel (from the underlying [Channel Manager](../channel-manager/)) for the current [end user](../../../glossary/#user) in that user's current [world](../../../glossary/#world).
     *
     * This is typically used together with the [World Manager](../world-manager). Note that this channel only gets notifications for worlds currently in memory. (See more background on [persistence](../../../run_persistence).)
     *
     * **Example**
     *
     *     var cm = new F.manager.ChannelManager();
     *     var worldManager = new F.manager.WorldManager({
     *         account: 'acme-simulations',
     *         project: 'supply-chain-game',
     *         model: 'model.eqn'
     *     });
     *     worldManager.getCurrentWorld().then(function (worldObject, worldService) {
     *         var userChannel = cm.getUserChannel(worldObject);
     *         userChannel.subscribe('', function (data) {
     *             console.log(data);
     *         });
     *      });
     *
     *
     * **Return Value**
     *
     * * *Channel* Returns the channel (an instance of the [Channel Service](../channel-service/)).
     *
     * **Parameters**
     *
     * @param  {String|Object} `world` World object or id.
     * @param  {String|Object} `user` (Optional) User object or id. If not provided, picks up ser id from current session if end user is logged in.
     * @param  {String} `groupName` (Optional) Group the world exists in. If not provided, picks up group from current session if end user is logged in.
     */
    getUserChannel: function (world, user, groupName) {
        var userid = ($.isPlainObject(user) && user.id) ? user.id : user;
        var worldid = ($.isPlainObject(world) && world.id) ? world.id : world;
        if (!worldid) {
            throw new Error('Please specify a world id');
        }
        userid = getFromSessionOrError(userid, 'userId');
        groupName = getFromSessionOrError(groupName, 'groupName');

        var baseTopic = ['/users', this.options.server.account, this.options.server.project, groupName, worldid, userid].join('/');
        return __super.getChannel.call(this, { base: baseTopic });
    }
});

module.exports = EpicenterChannelManager;

},{"../service/url-config-service":31,"../util/inherit":39,"./auth-manager":6,"./channel-manager":7}],9:[function(require,module,exports){
'use strict';

module.exports = {
    EPI_COOKIE_KEY: 'epicenter.project.token',
    EPI_SESSION_KEY: 'epicenter.user.session',
    STRATEGY_SESSION_KEY: 'epicenter-scenario'
};
},{}],10:[function(require,module,exports){
/**
* ## Run Manager
*
* The Run Manager gives you control over run creation depending on run states. Specifically, you can select run creation strategies (rules) for which runs end users of your project work with when they log in to your project.
*
* Underlying Epicenter APIs -- including the [Model Run API](../../../rest_apis/other_apis/model_apis/run/), the [Run API](../../../rest_apis/aggregate_run_api), and Epicenter.js's own [F.service.Run.create()](../run-api-service/) -- all allow you to create new runs. However, for some projects it makes more sense to pick up where the user left off, using an existing run. And in some projects, whether to create a new one or use an existing one is conditional, for example based on characteristics of the existing run or your own knowledge about the model. The Run Manager provides this level of control.
*
* ### Using the Run Manager to create and access runs
*
* To use the Run Manager, instantiate it by passing in:
*
*   * `run`: (required) Run object. Must contain:
*       * `account`: Epicenter account id (**Team ID** for team projects, **User ID** for personal projects).
*       * `project`: Epicenter project id.
*       * `model`: The name of your primary model file. (See more on [Writing your Model](../../../writing_your_model/).)
*       * `scope`: (optional) Scope object for the run, for example `scope.group` with value of the name of the group.
*       * `files`: (optional) If and only if you are using a Vensim model and you have additional data to pass in to your model, you can pass a `files` object with the names of the files, for example: `"files": {"data": "myExtraData.xls"}`. (Note that you'll also need to add this same files object to your Vensim [configuration file](../../../model_code/vensim/).) See the [underlying Model Run API](../../../rest_apis/other_apis/model_apis/run/#post-creating-a-new-run-for-this-project) for additional information.
*
*   * `strategy`: (optional) Run creation strategy for when to create a new run and when to reuse an end user's existing run. See [Run Manager Strategies](../../strategy/) for details. Defaults to `new-if-initialized`.
*
*   * `sessionKey`: (optional) Name of browser cookie in which to store run information, including run id. Many conditional strategies, including the provided strategies, rely on this browser cookie to store the run id and help make the decision of whether to create a new run or use an existing one. The name of this cookie defaults to `epicenter-scenario` and can be set with the `sessionKey` parameter.
*
*
* After instantiating a Run Manager, make a call to `getRun()` whenever you need to access a run for this end user. The `RunManager.run` contains the instantiated [Run Service](../run-api-service/).
*
* **Example**
*
*       var rm = new F.manager.RunManager({
*           run: {
*               account: 'acme-simulations',
*               project: 'supply-chain-game',
*               model: 'supply-chain-model.jl',
*               server: { host: 'api.forio.com' }
*           },
*           strategy: 'always-new',
*           sessionKey: 'epicenter-session'
*       });
*       rm.getRun()
*           .then(function(run) {
*               // the return value of getRun() is an instance of Run Service
*               var thisRunId = run.id;
*               // the RunManager.run also contains the instantiated Run Service,
*               // so any Run Service method is valid here
*               rm.run.do('runModel');
*       })
*
*/

'use strict';
var strategiesMap = require('./run-strategies/strategies-map');
var specialOperations = require('./special-operations');
var RunService = require('../service/run-api-service');


function patchRunService(service, manager) {
    if (service.patched) {
        return service;
    }

    var orig = service.do;
    service.do = function (operation, params, options) {
        var reservedOps = Object.keys(specialOperations);
        if (reservedOps.indexOf(operation) === -1) {
            return orig.apply(service, arguments);
        } else {
            return specialOperations[operation].call(service, params, options, manager);
        }
    };

    service.patched = true;

    return service;
}



var defaults = {
    /**
     * Run creation strategy for when to create a new run and when to reuse an end user's existing run. See [Run Manager Strategies](../../strategy/) for details. Defaults to `new-if-initialized`.
     * @type {String}
     */

    strategy: 'new-if-initialized'
};

function RunManager(options) {
    this.options = $.extend(true, {}, defaults, options);

    if (this.options.run instanceof RunService) {
        this.run = this.options.run;
    } else {
        this.run = new RunService(this.options.run);
    }

    patchRunService(this.run, this);

    var StrategyCtor = typeof this.options.strategy === 'function' ? this.options.strategy : strategiesMap[this.options.strategy];

    if (!StrategyCtor) {
        throw new Error('Specified run creation strategy was invalid:', this.options.strategy);
    }

    this.strategy = new StrategyCtor(this.run, this.options);
}

RunManager.prototype = {
    /**
     * Returns the run object for a 'good' run.
     *
     * A good run is defined by the strategy. For example, if the strategy is `always-new`, the call
     * to `getRun()` always returns a newly created run; if the strategy is `new-if-persisted`,
     * `getRun()` creates a new run if the previous run is in a persisted state, otherwise
     * it returns the previous run. See [Run Manager Strategies](../../strategy/) for more on strategies.
     *
     *  **Example**
     *
     *      rm.getRun().then(function (run) {
     *          // use the run object
     *          var thisRunId = run.id;
     *
     *          // use the Run Service object
     *          run.do('runModel');
     *      });
     *
     * **Parameters**
     * @param {None} None
     */
    getRun: function () {
        return this.strategy
                .getRun();
    },

    /**
     * Returns the run object for a new run, regardless of strategy: force creation of a new run.
     *
     *  **Example**
     *
     *      rm.reset().then(function (run) {
     *          // use the (new) run object
     *          var thisRunId = run.id;
     *          // use the Run Service object
     *          run.do('runModel');
     *      });
     *
     * **Parameters**
     * @param {Object} `runServiceOptions` The options object to configure the Run Service. See [Run API Service](../run-api-service/) for more.
     */
    reset: function (runServiceOptions) {
        return this.strategy.reset(runServiceOptions);
    }
};

module.exports = RunManager;

},{"../service/run-api-service":29,"./run-strategies/strategies-map":20,"./special-operations":22}],11:[function(require,module,exports){
'use strict';

var classFrom = require('../../util/inherit');
var ConditionalStrategy = require('./conditional-creation-strategy');

var __super = ConditionalStrategy.prototype;

var Strategy = classFrom(ConditionalStrategy, {
    constructor: function (runService, options) {
        __super.constructor.call(this, runService, this.createIf, options);
    },

    createIf: function (run, headers) {
        // always create a new run!
        return true;
    }
});

module.exports = Strategy;

},{"../../util/inherit":39,"./conditional-creation-strategy":13}],12:[function(require,module,exports){
'use strict';

var classFrom = require('../../util/inherit');
var IdentityStrategy = require('./identity-strategy');
var StorageFactory = require('../../store/store-factory');
var StateApi = require('../../service/state-api-adapter');
var AuthManager = require('../auth-manager');
var keyNames = require('../key-names');

var defaults = {
    store: {
        synchronous: true
    }
};

var Strategy = classFrom(IdentityStrategy, {
    constructor: function Strategy(runService, options) {
        this.run = runService;
        this.options = $.extend(true, {}, defaults, options);
        this.runOptions = this.options.run;
        this._store = new StorageFactory(this.options.store);
        this.stateApi = new StateApi();
        this._auth = new AuthManager();

        this._loadAndCheck = this._loadAndCheck.bind(this);
        this._restoreRun = this._restoreRun.bind(this);
        this._getAllRuns = this._getAllRuns.bind(this);
        this._loadRun = this._loadRun.bind(this);
    },

    reset: function (runServiceOptions) {
        // creates a grand new run with group id (account too?) and set freshly created to true
        var session = this._auth.getCurrentUserSessionInfo();
        var opt = $.extend({
            scope: { group: session.groupId }
        }, this.runOptions);

        return this.run
            .create(opt, runServiceOptions)
            .then(function (run) {
                run.freshlyCreated = true;
                return run;
            });
    },

    getRun: function () {
        return this._getAllRuns()
            .then(this._loadAndCheck);
    },

    _getAllRuns: function () {
        // get all runs with the current user and group, to be filtered later
        var session = JSON.parse(this._store.get(keyNames.EPI_SESSION_KEY) || '{}');
        return this.run.query({
            'user.id': session.userId || '0000',
            'scope.group': session.groupId
        });
    },

    _loadAndCheck: function (runs) {
        // Check if latest run is not yet initialized, if not we load it, else we load the baserun, else create new run
        if (!runs || !runs.length) {
            return this.reset();
        }
        var latestRun = this._sortRuns(runs)[0];
        var _this = this;
        var shouldReplay = false;
        var baseRuns = this._sortRuns(this._baseRuns(runs));


        if (!latestRun.initialized) {
            // uninitialized run will have finish initializing first
            return this.run.load(latestRun.id, null, {
                success: function (run, msg, headers) {
                    shouldReplay = headers.getResponseHeader('pragma') === 'persistent';
                }
            }).then(function (run) {
                return shouldReplay ? _this._restoreRun(run.id) : run;
            });
        } else if (baseRuns && baseRuns.length) {
            var baseRun = baseRuns[0];
            return this.run.load(baseRun.id, null, {
                success: function (run, msg, headers) {
                    shouldReplay = headers.getResponseHeader('pragma') === 'persistent';
                }
            }).then(function (run) {
                return shouldReplay ? _this._restoreRun(run.id) : run;
            });
        } else {
            return this.reset();
        }
    },

    _sortRuns: function (runs) {
        var dateComp = function (a, b) { return new Date(b.date) - new Date(a.date); };
        return runs.sort(dateComp);
    },

    _baseRuns: function (runs) {
        return _.filter(runs, function (run) {
            return run.baseRun;
        });
    },

    _restoreRun: function (runId) {
        var _this = this;
        return this.stateApi.replay({ runId: runId })
            .then(function (resp) {
                return _this._loadRun(resp.run);
            });
    },

    _loadRun: function (id, options) {
        return this.run.load(id, null, options);
    }

});

module.exports = Strategy;

},{"../../service/state-api-adapter":30,"../../store/store-factory":36,"../../util/inherit":39,"../auth-manager":6,"../key-names":9,"./identity-strategy":14}],13:[function(require,module,exports){
'use strict';

var makeSeq = require('../../util/make-sequence');
var Base = require('./identity-strategy');
var SessionStore = require('../../store/store-factory');
var classFrom = require('../../util/inherit');
var UrlService = require('../../service/url-config-service');
var AuthManager = require('../auth-manager');

var sessionStore = new SessionStore({});
var urlService = new UrlService();
var keyNames = require('../key-names');

var defaults = {
    sessionKey: keyNames.STRATEGY_SESSION_KEY
};

function setRunInSession(sessionKey, run) {
    var path = '/' + [urlService.appPath, urlService.accountPath, urlService.projectPath].join('/');

    // make sure we don't get consecuteive '/' so we have a valid path for the session
    path = path.replace(/\/{2,}/g,'/');

    // set the seesionKey for the run
    sessionStore.set(sessionKey, JSON.stringify({ runId: run.id }), { root: path });
}

/**
* Conditional Creation Strategy
* This strategy will try to get the run stored in the cookie and
* evaluate if needs to create a new run by calling the 'condition' function
*/

/* jshint eqnull: true */
var Strategy = classFrom(Base, {
    constructor: function Strategy(runService, condition, options) {

        if (condition == null) {
            throw new Error('Conditional strategy needs a condition to createte a run');
        }

        this._auth = new AuthManager();
        this.run = makeSeq(runService);
        this.condition = typeof condition !== 'function' ? function () { return condition; } : condition;
        this.options = $.extend(true, {}, defaults, options);
        this.runOptions = this.options.run;
    },

    reset: function (runServiceOptions) {
        var _this = this;
        var session = this._auth.getCurrentUserSessionInfo();
        var opt = $.extend({
            scope: { group: session.groupId }
        }, this.runOptions);

        return this.run
                .create(opt, runServiceOptions)
            .then(function (run) {
                setRunInSession(_this.options.sessionKey, run);
                run.freshlyCreated = true;
                return run;
            })
            .start();
    },

    getRun: function () {
        var session = this._auth.getCurrentUserSessionInfo();

        if (session && session.runId) {
            return this._loadAndCheck(session);
        } else {
            return this.reset();
        }
    },

    _loadAndCheck: function (session) {
        var shouldCreate = false;
        var _this = this;

        return this.run
            .load(session.runId, null, {
                success: function (run, msg, headers) {
                    shouldCreate = _this.condition.call(_this, run, headers);
                }
            })
            .then(function (run) {
                if (shouldCreate) {
                    // we need to do this, on the original runService (ie not sequencialized)
                    // so we don't get in the middle of the queue
                    return _this.run.original.create(_this.runOptions)
                    .then(function (run) {
                        setRunInSession(_this.options.sessionKey, run);
                        run.freshlyCreated = true;
                        return run;
                    });
                }

                return run;
            })
            .start();
    }
});

module.exports = Strategy;

},{"../../service/url-config-service":31,"../../store/store-factory":36,"../../util/inherit":39,"../../util/make-sequence":40,"../auth-manager":6,"../key-names":9,"./identity-strategy":14}],14:[function(require,module,exports){
'use strict';

var classFrom = require('../../util/inherit');
var Base = {};

// Interface that all strategies need to implement
module.exports = classFrom(Base, {
    constructor: function (runService, options) {
        this.runService  = runService;
    },

    reset: function () {
        // return a newly created run
        return $.Deferred().resolve().promise();
    },

    getRun: function () {
        // return a usable run
        return $.Deferred().resolve(this.runService).promise();
    }
});

},{"../../util/inherit":39}],15:[function(require,module,exports){
'use strict';

var classFrom = require('../../util/inherit');

var IdentityStrategy = require('./identity-strategy');
var WorldApiAdapter = require('../../service/world-api-adapter');
var AuthManager = require('../auth-manager');

var defaults = {
    store: {
        synchronous: true
    }
};

var Strategy = classFrom(IdentityStrategy, {

    constructor: function (runService, options) {
        this.runService = runService;
        this.options = $.extend(true, {}, defaults, options);
        this._auth = new AuthManager();
        this._loadRun = this._loadRun.bind(this);
        this.worldApi = new WorldApiAdapter(this.options.run);
    },

    reset: function () {
        var session = this._auth.getCurrentUserSessionInfo();
        var curUserId = session.userId;
        var curGroupName = session.groupName;

        return this.worldApi
            .getCurrentWorldForUser(curUserId, curGroupName)
            .then(function (world) {
                return this.worldApi.newRunForWorld(world.id);
            }.bind(this));
    },

    getRun: function () {
        var session = this._auth.getCurrentUserSessionInfo();
        var curUserId = session.userId;
        var curGroupName = session.groupName;
        var worldApi = this.worldApi;
        var model = this.options.model;
        var _this = this;
        var dtd = $.Deferred();

        if (!curUserId) {
            return dtd.reject({ statusCode: 400, error: 'We need an authenticated user to join a multiplayer world. (ERR: no userId in session)' }, session).promise();
        }

        var loadRunFromWorld = function (world) {
            if (!world) {
                return dtd.reject({ statusCode: 404, error: 'The user is not in any world.' }, { options: this.options, session: session });
            }

            return worldApi.getCurrentRunId({ model: model, filter: world.id })
                .then(_this._loadRun)
                .then(dtd.resolve)
                .fail(dtd.reject);
        };

        var serverError = function (error) {
            // is this possible?
            dtd.reject(error, session, this.options);
        };

        this.worldApi
            .getCurrentWorldForUser(curUserId, curGroupName)
            .then(loadRunFromWorld)
            .fail(serverError);

        return dtd.promise();
    },

    _loadRun: function (id, options) {
        return this.runService.load(id, null, options);
    }
});

module.exports = Strategy;

},{"../../service/world-api-adapter":34,"../../util/inherit":39,"../auth-manager":6,"./identity-strategy":14}],16:[function(require,module,exports){
'use strict';
var classFrom = require('../../util/inherit');
var ConditionalStrategy = require('./conditional-creation-strategy');

var __super = ConditionalStrategy.prototype;

var Strategy = classFrom(ConditionalStrategy, {
    constructor: function (runService, options) {
        __super.constructor.call(this, runService, this.createIf, options);
    },

    createIf: function (run, headers) {
        return headers.getResponseHeader('pragma') === 'persistent' || run.initialized;
    }
});

module.exports = Strategy;

},{"../../util/inherit":39,"./conditional-creation-strategy":13}],17:[function(require,module,exports){
'use strict';

var classFrom = require('../../util/inherit');
var ConditionalStrategy = require('./conditional-creation-strategy');

var __super = ConditionalStrategy.prototype;

/*
*  create a new run only if nothing is stored in the cookie
*  this is useful for baseRuns.
*/
var Strategy = classFrom(ConditionalStrategy, {
    constructor: function (runService, options) {
        __super.constructor.call(this, runService, this.createIf, options);
    },

    createIf: function (run, headers) {
        // if we are here, it means that the run exists... so we don't need a new one
        return false;
    }
});

module.exports = Strategy;

},{"../../util/inherit":39,"./conditional-creation-strategy":13}],18:[function(require,module,exports){
'use strict';
var classFrom = require('../../util/inherit');
var ConditionalStrategy = require('./conditional-creation-strategy');

var __super = ConditionalStrategy.prototype;

var Strategy = classFrom(ConditionalStrategy, {
    constructor: function (runService, options) {
        __super.constructor.call(this, runService, this.createIf, options);
    },

    createIf: function (run, headers) {
        return headers.getResponseHeader('pragma') === 'persistent';
    }
});

module.exports = Strategy;

},{"../../util/inherit":39,"./conditional-creation-strategy":13}],19:[function(require,module,exports){
'use strict';

var classFrom = require('../../util/inherit');
var IdentityStrategy = require('./identity-strategy');
var StorageFactory = require('../../store/store-factory');
var StateApi = require('../../service/state-api-adapter');

var keyNames = require('../key-names');

var defaults = {
    store: {
        synchronous: true
    }
};

var Strategy = classFrom(IdentityStrategy, {
    constructor: function Strategy(runService, options) {
        this.run = runService;
        this.options = $.extend(true, {}, defaults, options);
        this.runOptions = this.options.run;
        this._store = new StorageFactory(this.options.store);
        this.stateApi = new StateApi();

        this._loadAndCheck = this._loadAndCheck.bind(this);
        this._restoreRun = this._restoreRun.bind(this);
        this._getAllRuns = this._getAllRuns.bind(this);
        this._loadRun = this._loadRun.bind(this);
    },

    reset: function (runServiceOptions) {
        var session = this._auth.getCurrentUserSessionInfo();
        var opt = $.extend({
            scope: { group: session.groupId }
        }, this.runOptions);

        return this.run
            .create(opt, runServiceOptions)
            .then(function (run) {
                run.freshlyCreated = true;
                return run;
            });
    },

    getRun: function () {
        return this._getAllRuns()
            .then(this._loadAndCheck);
    },

    _getAllRuns: function () {
        var session = JSON.parse(this._store.get(keyNames.EPI_SESSION_KEY) || '{}');
        return this.run.query({
            'user.id': session.userId || '0000',
            'scope.group': session.groupName
        });
    },

    _loadAndCheck: function (runs) {
        if (!runs || !runs.length) {
            return this.reset();
        }

        var dateComp = function (a, b) { return new Date(b.date) - new Date(a.date); };
        var latestRun = runs.sort(dateComp)[0];
        var _this = this;
        var shouldReplay = false;

        return this.run.load(latestRun.id, null, {
            success: function (run, msg, headers) {
                shouldReplay = headers.getResponseHeader('pragma') === 'persistent';
            }
        }).then(function (run) {
            return shouldReplay ? _this._restoreRun(run.id) : run;
        });
    },

    _restoreRun: function (runId) {
        var _this = this;
        return this.stateApi.replay({ runId: runId })
            .then(function (resp) {
                return _this._loadRun(resp.run);
            });
    },

    _loadRun: function (id, options) {
        return this.run.load(id, null, options);
    }

});

module.exports = Strategy;

},{"../../service/state-api-adapter":30,"../../store/store-factory":36,"../../util/inherit":39,"../key-names":9,"./identity-strategy":14}],20:[function(require,module,exports){
module.exports = {
    'new-if-initialized': require('./new-if-initialized-strategy'),
    'new-if-persisted': require('./new-if-persisted-strategy'),
    'new-if-missing': require('./new-if-missing-strategy'),
    'always-new': require('./always-new-strategy'),
    'multiplayer': require('./multiplayer-strategy'),
    'persistent-single-player': require('./persistent-single-player-strategy'),
    'none': require('./identity-strategy'),
    'base-if-initialized': require('./base-if-initialized-strategy')
};

},{"./always-new-strategy":11,"./base-if-initialized-strategy":12,"./identity-strategy":14,"./multiplayer-strategy":15,"./new-if-initialized-strategy":16,"./new-if-missing-strategy":17,"./new-if-persisted-strategy":18,"./persistent-single-player-strategy":19}],21:[function(require,module,exports){
'use strict';
var RunService = require('../service/run-api-service');

var defaults = {
    validFilter: { saved: true }
};

function ScenarioManager(options) {
    this.options = $.extend(true, {}, defaults, options);
    this.runService = this.options.run || new RunService(this.options);
}

ScenarioManager.prototype = {
    getRuns: function (filter) {
        this.filter = $.extend(true, {}, this.options.validFilter, filter);
        return this.runService.query(this.filter);
    },

    loadVariables: function (vars) {
        return this.runService.query(this.filter, { include: vars });
    },

    save: function (run, meta) {
        return this._getService(run).save($.extend(true, {}, { saved: true }, meta));
    },

    archive: function (run) {
        return this._getService(run).save({ saved: false });
    },

    _getService: function (run) {
        if (typeof run === 'string') {
            return new RunService($.extend(true, {},  this.options, { filter: run }));
        }

        if (typeof run === 'object' && run instanceof RunService) {
            return run;
        }

        throw new Error('Save method requires a run service or a runId');
    },

    getRun: function (runId) {
        return new RunService($.extend(true, {},  this.options, { filter: runId }));
    }
};

module.exports = ScenarioManager;


},{"../service/run-api-service":29}],22:[function(require,module,exports){
'use strict';


module.exports = {
    reset: function (params, options, manager) {
        return manager.reset(options);
    }
};

},{}],23:[function(require,module,exports){
/**
* ## World Manager
*
* As discussed under the [World API Adapter](../world-api-adapter/), a [run](../../../glossary/#run) is a collection of end user interactions with a project and its model. For building multiplayer simulations you typically want multiple end users to share the same set of interactions, and work within a common state. Epicenter allows you to create "worlds" to handle such cases.
*
* The [World API Adapter](../world-api-adapter/) handles creating multiplayer worlds, and adding and removing end users and runs from a world.
*
* The World Manager provides an easy way to track and access the current world and run for particular end users.
*
* ### Using the World Manager
*
* To use the World Manager, instantiate it. Then, make calls to any of the methods you need:
*
*       var wMgr = new F.manager.WorldManager()
*       wMgr.getCurrentWorld();
*       wMgr.getCurrentRun();
*
* Note that the World Manager does *not* create worlds automatically. (This is different than the [Run Manager](../run-manager).) However, you can pass in specific options to any runs created by the manager, using a `run` object.
*
* When you instantiate a World Manager, the world's account id, project id, and group are automatically taken from the session (thanks to the [Authentication Service](../auth-api-service)). However, you can override these by optionally passing in:
*
*   * `account`: The **Team ID** in the Epicenter user interface for this project.
*   * `project`: The **Project ID** for this project.
*   * `group`: The **Group Name** for this world.
*   * `run`: Options to use when creating new runs with the manager, e.g. `run: {files: ['data.xls']}`.
*
* For example:
*
*       var wMgr = new F.manager.WorldManager({
*          account: 'acme-simulations',
*          project: 'supply-chain-game',
*          group: 'team1'
*       });
*
*/

'use strict';

var WorldApi = require('../service/world-api-adapter');
var RunManager =  require('./run-manager');
var AuthManager = require('./auth-manager');
var worldApi;

// var defaults = {
//  account: '',
//  project: '',
//  group: '',
//  transport: {
//  }
// };


function buildStrategy(worldId, dtd) {

    return function Ctor(runService, options) {
        this.runService = runService;
        this.options = options;

        $.extend(this, {
            reset: function () {
                throw new Error('not implementd. Need api changes');
            },

            getRun: function () {
                var _this = this;
                //get or create!
                // Model is required in the options
                return worldApi.getCurrentRunId({ model: this.options.run.model, filter: worldId })
                    .then(function (runId) {
                        return _this.runService.load(runId);
                    })
                    .then(function (run) {
                        dtd.resolve.call(this, run, _this.runService);
                    })
                    .fail(dtd.reject);
                }
            }
        );
    };
}


module.exports = function (options) {
    this.options = options || { run: {}, world: {} };

    $.extend(true, this.options, this.options.run);
    $.extend(true, this.options, this.options.world);

    worldApi = new WorldApi(this.options);
    this._auth = new AuthManager();
    var _this = this;

    var api = {

        /**
        * Returns the current world (object) and an instance of the [World API Adapter](../world-api-adapter/).
        *
        * **Example**
        *
        *       var wMgr = new F.manager.WorldManager()
        *       wMgr.getCurrentWorld()
        *           .then(function(world, worldAdapter) {
        *               console.log(world.id);
        *               worldAdapter.getCurrentRunId();
        *           });
        *
        * **Parameters**
        * @param {string} `userId` (Optional) The id of the user whose world is being accessed. Defaults to the user in the current session.
        * @param {string} `groupName` (Optional) The name of the group whose world is being accessed. Defaults to the group for the user in the current session.
        */
        getCurrentWorld: function (userId, groupName) {
            var session = this._auth.getCurrentUserSessionInfo();
            if (!userId) {
                userId = session.userId;
            }
            if (!groupName) {
                groupName = session.groupName;
            }
            return worldApi.getCurrentWorldForUser(userId, groupName);
        },

        /**
        * Returns the current run (object) and an instance of the [Run API Service](../run-api-service/).
        *
        * **Example**
        *
        *       var wMgr = new F.manager.WorldManager()
        *       wMgr.getCurrentRun()
        *           .then(function(run, runService) {
        *               console.log(run.id);
        *               runService.do('runModel');
        *           });
        *
        * **Parameters**
        * @param {string} `model` The name of the model file.
        */
        getCurrentRun: function (model) {
            var dtd = $.Deferred();
            var session = this._auth.getCurrentUserSessionInfo();
            var curUserId = session.userId;
            var curGroupName = session.groupName;

            function getAndRestoreLatestRun(world) {
                if (!world) {
                    return dtd.reject({ error: 'The user is not part of any world!' });
                }

                var currentWorldId = world.id;
                var runOpts = $.extend(true, _this.options, { model: model });
                var strategy = buildStrategy(currentWorldId, dtd);
                var opt = $.extend(true, {}, {
                    strategy: strategy,
                    run: runOpts
                });
                var rm = new RunManager(opt);

                return rm.getRun()
                    .then(function (run) {
                        dtd.resolve(run, rm.runService, rm);
                    });
            }

            this.getCurrentWorld(curUserId, curGroupName)
                .then(getAndRestoreLatestRun);

            return dtd.promise();
        }
    };

    $.extend(this, api);
};

},{"../service/world-api-adapter":34,"./auth-manager":6,"./run-manager":10}],24:[function(require,module,exports){
/**
 *
 * ##Authentication API Service
 *
 * The Authentication API Service provides methods for logging in and logging out. On login, this service creates and returns a user access token.
 *
 * User access tokens are required for each call to Epicenter. (See [Project Access](../../../project_access/) for more information.)
 *
 * If you need additional functionality -- such as tracking session information, easily retrieving the user token, or getting the groups to which an end user belongs -- consider using the [Authorization Manager](../auth-manager/) instead.
 *
 *      var auth = new F.service.Auth();
 *      auth.login({ userName: 'jsmith@acmesimulations.com',
 *                  password: 'passw0rd' });
 *      auth.logout();
 */

'use strict';

var ConfigService = require('./configuration-service');
var TransportFactory = require('../transport/http-transport-factory');

module.exports = function (config) {
    var defaults = {
        /**
         * Email or username to use for logging in. Defaults to empty string.
         * @type {String}
         */
        userName: '',

        /**
         * Password for specified `userName`. Defaults to empty string.
         * @type {String}
         */
        password: '',

        /**
         * The account id for this `userName`. In the Epicenter UI, this is the **Team ID** (for team projects) or the **User ID** (for personal projects). Required if the `userName` is for an [end user](../../../glossary/#users). Defaults to empty string.
         * @type {String}
         */
        account: '',

        /**
         * Options to pass on to the underlying transport layer. All jquery.ajax options at http://api.jquery.com/jQuery.ajax/ are available. Defaults to empty object.
         * @type {Object}
         */
        transport: {}
    };
    var serviceOptions = $.extend({}, defaults, config);
    var urlConfig = new ConfigService(serviceOptions).get('server');

    var transportOptions = $.extend(true, {}, serviceOptions.transport, {
        url: urlConfig.getAPIPath('authentication')
    });
    var http = new TransportFactory(transportOptions);

    var publicAPI = {

        /**
         * Logs user in, returning the user access token.
         *
         * If no `userName` or `password` were provided in the initial configuration options, they are required in the `options` here. If no `account` was provided in the initial configuration options and the `userName` is for an [end user](../../../glossary/#users), the `account` is required as well.
         *
         * **Example**
         *
         *      auth.login({
         *          userName: 'jsmith',
         *          password: 'passw0rd',
         *          account: 'acme-simulations' })
         *      .then(function (token) {
         *          console.log("user access token is: ", token.access_token);
         *      });
         *
         * **Parameters**
         * @param {Object} `options` (Optional) Overrides for configuration options.
         */
        login: function (options) {
            var httpOptions = $.extend(true, { success: $.noop }, serviceOptions, options);
            if (!httpOptions.userName || !httpOptions.password) {
                var resp = { status: 401, statusMessage: 'No username or password specified.' };
                if (options.error) {
                    options.error.call(this, resp);
                }

                return $.Deferred().reject(resp).promise();
            }

            var postParams = {
                userName: httpOptions.userName,
                password: httpOptions.password,
            };
            if (httpOptions.account) {
                //pass in null for account under options if you don't want it to be sent
                postParams.account = httpOptions.account;
            }

            return http.post(postParams, httpOptions);
        },

        /**
         * Logs user out from specified accounts.
         *
         * **Example**
         *
         *      auth.logout();
         *
         * **Parameters**
         * @param {Object} `options` (Optional) Overrides for configuration options.
         */
        logout: function (options) {
            var httpOptions = $.extend(true, serviceOptions, transportOptions, options);
            if (!httpOptions.token) {
                throw new Error('No token was specified.');
            }
            var slash = httpOptions.url.slice(-1) === '/' ? '' : '/';
            httpOptions.url = httpOptions.url + slash + httpOptions.token;
            var deleteParams = {};

            return http.delete(deleteParams, httpOptions);
        }
    };

    $.extend(this, publicAPI);
};

},{"../transport/http-transport-factory":38,"./configuration-service":26}],25:[function(require,module,exports){
'use strict';

/**
 * ## Channel Service
 *
 * The Epicenter platform provides a push channel, which allows you to publish and subscribe to messages within a [project](../../../glossary/#projects), [group](../../../glossary/#groups), or [multiplayer world](../../../glossary/#world). There are two main use cases for the channel: event notifications and chat messages.
 *
 * The Channel Service is a building block for this functionality. It creates a publish-subscribe object, allowing you to publish messages, subscribe to messages, or unsubscribe from messages for a given 'topic' on a `$.cometd` transport instance.
 *
 * Typically, you use the [Epicenter Channel Manager](../epicenter-channel-manager/) to create or retrieve channels, then use the Channel Service `subscribe()` and `publish()` methods to listen to or update data. (For additional background on Epicenter's push channel, see the introductory notes on the [Push Channel API](../../../rest_apis/multiplayer/channel/) page.)
 *
 * You'll need to include the `epicenter-multiplayer-dependencies.js` library in addition to the `epicenter.js` library in your project to use the Channel Service. (See [Including Epicenter.js](../../#include).)
 *
 * To use the Channel Service, instantiate it, then make calls to any of the methods you need.
 *
 *        var cs = new F.service.Channel();
 *        cs.publish('run/variables', {price: 50});
 *
 * The parameters for instantiating a Channel Service include:
 *
 * * `options` The options object to configure the Channel Service.
 * * `options.base` The base topic. This is added as a prefix to all further topics you publish or subscribe to while working with this Channel Service.
 * * `options.topicResolver` A function that processes all 'topics' passed into the `publish` and `subscribe` methods. This is useful if you want to implement your own serialize functions for converting custom objects to topic names. Returns a String. By default, it just echoes the topic.
 * * `options.transport` The instance of `$.cometd` to hook onto. See http://docs.cometd.org/reference/javascript.html for additional background on cometd.
 */
var Channel = function (options) {
    var defaults = {

        /**
         * The base topic. This is added as a prefix to all further topics you publish or subscribe to while working with this Channel Service.
         */
        base: '',

        /**
         * A function that processes all 'topics' passed into the `publish` and `subscribe` methods. This is useful if you want to implement your own serialize functions for converting custom objects to topic names. By default, it just echoes the topic.
         *
         * **Parameters**
         *
         * * `topic` Topic to parse.
         *
         * **Return Value**
         *
         * * *String*: This function should return a string topic.
         */
        topicResolver: function (topic) {
            return topic;
        },

        /**
         * The instance of `$.cometd` to hook onto.
         */
        transport: null
    };
    this.channelOptions = $.extend(true, {}, defaults, options);
};

var makeName = function (channelName, topic) {
    //Replace trailing/double slashes
    var newName = (channelName ? (channelName + '/' + topic) : topic).replace(/\/\//g, '/').replace(/\/$/,'');
    return newName;
};


Channel.prototype = $.extend(Channel.prototype, {

    // future functionality:
    //      // Set the context for the callback
    //      cs.subscribe('run', function () { this.innerHTML = 'Triggered'}, document.body);
     //
     //      // Control the order of operations by setting the `priority`
     //      cs.subscribe('run', cb, this, {priority: 9});
     //
     //      // Only execute the callback, `cb`, if the value of the `price` variable is 50
     //      cs.subscribe('run/variables/price', cb, this, {priority: 30, value: 50});
     //
     //      // Only execute the callback, `cb`, if the value of the `price` variable is greater than 50
     //      subscribe('run/variables/price', cb, this, {priority: 30, value: '>50'});
     //
     //      // Only execute the callback, `cb`, if the value of the `price` variable is even
     //      subscribe('run/variables/price', cb, this, {priority: 30, value: function (val) {return val % 2 === 0}});


    /**
     * Subscribe to changes on a topic.
     *
     *  **Examples**
     *
     *      // Subscribe to changes on a top-level 'run' topic
     *      cs.subscribe('run', cb);
     *
     *      // Subscribe to changes on children of the 'run' topic. Note this will also be triggered for changes to run.x.y.z.
     *      cs.subscribe('run/*');
     *
     *      // Subscribe to changes on both the top-level 'run' topic and its children
     *      cs.subscribe(['run', 'run/*']);
     *
     *      // Subscribe to changes on a particular variable
     *      subscribe('run/variables/price', cb);
     *
     *
     * **Return Value**
     *
     * * *String* Returns a token you can later use to unsubscribe.
     *
     * **Parameters**
     * @param  {String|Array}   `topic`    List of topics to listen for changes on.
     * @param  {Function} `callback` Callback function to execute. Callback is called with signature `(evt, payload, metadata)`.
     * @param  {Object}   `context`  Context in which the `callback` is executed.
     * @param  {Object}   `options`  (Optional) Overrides for configuration options.
     * @param  {Number}   `options.priority`  Used to control order of operations. Defaults to 0. Can be any +ve or -ve number.
     * @param  {String|Number|Function}   `options.value` The `callback` is only triggered if this condition matches. See examples for details.
     *
     */
    subscribe: function (topic, callback, context, options) {

        var topics = [].concat(topic);
        var me = this;
        var subscriptionIds = [];
        var opts = me.channelOptions;

        opts.transport.batch(function () {
            $.each(topics, function (index, topic) {
                topic = makeName(opts.base, opts.topicResolver(topic));
                subscriptionIds.push(opts.transport.subscribe(topic, callback));
            });
        });
        return (subscriptionIds[1] ? subscriptionIds : subscriptionIds[0]);
    },

    /**
     * Publish data to a topic.
     *
     * **Examples**
     *
     *      // Send data to all subscribers of the 'run' topic
     *      cs.publish('run', {completed: false});
     *
     *      // Send data to all subscribers of the 'run/variables' topic
     *      cs.publish('run/variables', {price: 50});
     *
     * **Parameters**
     *
     * @param  {String} `topic` Topic to publish to.
     * @param  {*} `payload`  Data to publish to topic.
     *
     */
    publish: function (topic, data) {
        var topics = [].concat(topic);
        var me = this;
        var returnObjs = [];
        var opts = me.channelOptions;


        opts.transport.batch(function () {
            $.each(topics, function (index, topic) {
                topic = makeName(opts.base, opts.topicResolver(topic));
                if (topic.charAt(topic.length - 1) === '*') {
                    topic = topic.replace(/\*+$/, '');
                    console.warn('You can cannot publish to channels with wildcards. Publishing to ', topic, 'instead');
                }
                returnObjs.push(opts.transport.publish(topic, data));
            });
        });
        return (returnObjs[1] ? returnObjs : returnObjs[0]);
    },

    /**
     * Unsubscribe from changes to a topic.
     *
     * **Example**
     *
     *      cs.unsubscribe('sampleToken');
     *
     * **Parameters**
     * @param  {String} `token` The token for topic is returned when you initially subscribe. Pass it here to unsubscribe from that topic.
     */
    unsubscribe: function (token) {
        this.channelOptions.transport.unsubscribe(token);
        return token;
    }

});

module.exports = Channel;

},{}],26:[function(require,module,exports){
/**
 * @class ConfigurationService
 *
 * All services take in a configuration settings object to configure themselves. A JS hash {} is a valid configuration object, but optionally you can use the configuration service to toggle configs based on the environment
 *
 * @example
 *     var cs = require('configuration-service')({
 *          dev: { //environment
                port: 3000,
                host: 'localhost',
            },
            prod: {
                port: 8080,
                host: 'api.forio.com',
                logLevel: 'none'
            },
            logLevel: 'DEBUG' //global
 *     });
 *
 *      cs.get('logLevel'); //returns 'DEBUG'
 *
 *      cs.setEnv('dev');
 *      cs.get('logLevel'); //returns 'DEBUG'
 *
 *      cs.setEnv('prod');
 *      cs.get('logLevel'); //returns 'none'
 *
 */

'use strict';
var urlService = require('./url-config-service');

module.exports = function (config) {
    //TODO: Environments
    var defaults = {
        logLevel: 'NONE'
    };
    var serviceOptions = $.extend({}, defaults, config);
    serviceOptions.server = urlService(serviceOptions.server);

    return {

        data: serviceOptions,

        /**
         * Set the environment key to get configuration options from
         * @param { string} env
         */
        setEnv: function (env) {

        },

        /**
         * Get configuration.
         * @param  { string} property optional
         * @return {*}          Value of property if specified, the entire config object otherwise
         */
        get: function (property) {
            return serviceOptions[property];
        },

        /**
         * Set configuration.
         * @param  { string|Object} key if a key is provided, set a key to that value. Otherwise merge object with current config
         * @param  {*} value  value for provided key
         */
        set: function (key, value) {
            serviceOptions[key] = value;
        }
    };
};


},{"./url-config-service":31}],27:[function(require,module,exports){
/**
 * ##Data API Service
 *
 * The Data API Service allows you to create, access, and manipulate data related to any of your projects. Data are organized in collections. Each collection contains a document; each element of this top-level document is a JSON object. (See additional information on the underlying [Data API](../../../rest_apis/data_api/).)
 *
 * All API calls take in an "options" object as the last parameter. The options can be used to extend/override the Data API Service defaults. In particular, the `root` option contains the name of the collection. If you have multiple collections within each of your projects, you can pass the collection name as an option for each call.
 *
 *      var ds = new F.service.Data({ root: 'survey-responses' });
 *      ds.saveAs('user1',
 *          { 'question1': 2, 'question2': 10,
 *           'question3': false, 'question4': 'sometimes' } );
 *      ds.saveAs('user2',
 *          { 'question1': 3, 'question2': 8,
 *           'question3': true, 'question4': 'always' } );
 *      ds.query('',{ 'question2': { '$gt': 9} });
 *
 */

'use strict';

var ConfigService = require('./configuration-service');
var StorageFactory = require('../store/store-factory');
var qutil = require('../util/query-util');
var TransportFactory = require('../transport/http-transport-factory');

module.exports = function (config) {
    var store = new StorageFactory({ synchronous: true });

    var defaults = {
        /**
         * Name of collection. Defaults to `/`, that is, the root level of your project at `forio.com/app/your-account-id/your-project-id/`. Required.
         * @type {String}
         */
        root: '/',

        /**
         * For operations that require authentication, pass in the user access token (defaults to empty string). If the user is already logged in to Epicenter, the user access token is already set in a cookie and automatically loaded from there. (See [more background on access tokens](../../../project_access/)).
         * @see [Authentication API Service](../auth-api-service/) for getting tokens.
         * @type {String}
         */
        token: store.get('epicenter.project.token') || '',

        apiKey: '',
        domain: 'forio.com',

        //Options to pass on to the underlying transport layer
        transport: {}
    };
    var serviceOptions = $.extend({}, defaults, config);

    var urlConfig = new ConfigService(serviceOptions).get('server');
    if (serviceOptions.account) {
        urlConfig.accountPath = serviceOptions.account;
    }
    if (serviceOptions.project) {
        urlConfig.projectPath = serviceOptions.project;
    }

    var getURL = function (key, root) {
        if (!root) {
            root = serviceOptions.root;
        }
        var url = urlConfig.getAPIPath('data') + qutil.addTrailingSlash(root);
        if (key) {
            url+= qutil.addTrailingSlash(key);
        }
        return url;
    };

    var httpOptions = $.extend(true, {}, serviceOptions.transport, {
        url: getURL
    });
    if (serviceOptions.token) {
        httpOptions.headers = {
            'Authorization': 'Bearer ' + serviceOptions.token
        };
    }
    var http = new TransportFactory(httpOptions);

    var publicAPI = {

        /**
         * Search for data within a collection.
         *
         * Searching using comparison or logical operators (as opposed to exact matches) requires MongoDB syntax. See the underlying [Data API](../../../rest_apis/data_api/#searching) for additional details.
         *
         * **Examples**
         *
         *      // request all data associated with document 'user1'
         *      ds.query('user1');
         *
         *      // exact matching:
         *      // request all documents in collection where 'question2' is 9
         *      ds.query('', { 'question2': 9});
         *
         *      // comparison operators:
         *      // request all documents in collection
         *      // where 'question2' is greater than 9
         *      ds.query('', { 'question2': { '$gt': 9} });
         *
         *      // logical operators:
         *      // request all documents in collection
         *      // where 'question2' is less than 10, and 'question3' is false
         *      ds.query('', { '$and': [ { 'question2': { '$lt':10} }, { 'question3': false }] });
         *
         *      // regular expresssions: use any Perl-compatible regular expressions
         *      // request all documents in collection
         *      // where 'question5' contains the string '*day'
         *      ds.query('', { 'question5': { '$regex': '*day' } });
         *
         * **Parameters**
         * @param {String} `key` The name of the document to search. Pass the empty string ('') to search the entire collection.
         * @param {Object} `query` The query object. For exact matching, this object contains the field name and field value to match. For matching based on comparison, this object contains the field name and the comparison expression. For matching based on logical operators, this object contains an expression using MongoDB syntax. See the underlying [Data API](../../../rest_apis/data_api/#searching) for additional examples.
         * @param {Object} `outputModifier` (Optional) Available fields include: `startrecord`, `endrecord`, `sort`, and `direction` (`asc` or `desc`).
         * @param {Object} `options` (Optional) Overrides for configuration options.
         *
         */
        query: function (key, query, outputModifier, options) {
            var params = $.extend(true, { q: query }, outputModifier);
            var httpOptions = $.extend(true, {}, serviceOptions, options);
            httpOptions.url = getURL(key, httpOptions.root);
            return http.get(params, httpOptions);
        },

        /**
         * Save data to an anonymous document within the collection.
         *
         * (Documents are top-level elements within a collection. Collections must be unique within this account (team or personal account) and project and are set with the `root` field in the `option` parameter. See the underlying [Data API](../../../rest_apis/data_api/) for additional background.)
         *
         * **Example**
         *
         *      ds.save('question1', 'yes');
         *      ds.save({question1:'yes', question2: 32 });
         *      ds.save({ name:'John', className: 'CS101' }, { root: 'students' });
         *
         * **Parameters**
         *
         * @param {String|Object} `key` If `key` is a string, it is the id of the element to save (create) in this document. If `key` is an object, the object is the data to save (create) in this document. In both cases, the id for the document is generated automatically.
         * @param {Object} `value` (Optional) The data to save. If `key` is a string, this is the value to save. If `key` is an object, the value(s) to save are already part of `key` and this argument is not required.
         * @param {Object} `options` (Optional) Overrides for configuration options.
         */
        save: function (key, value, options) {
            var attrs;
            if (typeof key === 'object') {
                attrs = key;
                options = value;
            } else {
                (attrs = {})[key] = value;
            }
            var httpOptions = $.extend(true, {}, serviceOptions, options);
            httpOptions.url = getURL('', httpOptions.root);

            return http.post(attrs, httpOptions);
        },

        /**
         * Save data to a named document or element within the collection. The `root` of the collection must be specified separately in configuration options, either as part of the call or as part of the initialization of ds.
         *
         * (Documents are top-level elements within a collection. Collections must be unique within this account (team or personal account) and project and are set with the `root` field in the `option` parameter. See the underlying [Data API](../../../rest_apis/data_api/) for additional background.)
         *
         * **Example**
         *
         *      ds.saveAs('user1',
         *          { 'question1': 2, 'question2': 10,
         *           'question3': false, 'question4': 'sometimes' } );
         *      ds.saveAs('student1',
         *          { firstName: 'john', lastName: 'smith' },
         *          { root: 'students' });
         *      ds.saveAs('mgmt100/groupB',
         *          { scenarioYear: '2015' },
         *          { root: 'myclasses' });
         *
         * **Parameters**
         *
         * @param {String} `key` Id of the document.
         * @param {Object} `value` (Optional) The data to save, in key:value pairs.
         * @param {Object} `options` (Optional) Overrides for configuration options.
         */
        saveAs: function (key, value, options) {
            var httpOptions = $.extend(true, {}, serviceOptions, options);
            httpOptions.url = getURL(key, httpOptions.root);

            return http.put(value, httpOptions);
        },

        /**
         * Get data for a specific document or field.
         *
         * **Example**
         *
         *      ds.load('user1');
         *      ds.load('user1/question3');
         *
         * **Parameters**
         * @param  {String|Object} `key` The id of the data to return. Can be the id of a document, or a path to data within that document.
         * @param {Object} `outputModifier` (Optional) Available fields include: `startrecord`, `endrecord`, `sort`, and `direction` (`asc` or `desc`).
         * @param {Object} `options` Overrides for configuration options.
         */
        load: function (key, outputModifier, options) {
            var httpOptions = $.extend(true, {}, serviceOptions, options);
            httpOptions.url = getURL(key, httpOptions.root);
            return http.get(outputModifier, httpOptions);
        },

        /**
         * Removes data from collection. Only documents (top-level elements in each collection) can be deleted.
         *
         * **Example**
         *
         *     ds.remove('user1');
         *
         *
         * **Parameters**
         *
         * @param {String} `key` The id of the document to remove from this collection.
         * @param {Object} `options` (Optional) Overrides for configuration options.
         */
        remove: function (keys, options) {
            var httpOptions = $.extend(true, {}, serviceOptions, options);
            var params;
            if ($.isArray(keys)) {
                params = { id: keys };
            } else {
                params = '';
                httpOptions.url = getURL(keys, httpOptions.root);
            }
            return http.delete(params, httpOptions);
        }

        // Epicenter doesn't allow nuking collections
        //     /**
        //      * Removes collection being referenced
        //      * @return null
        //      */
        //     destroy: function (options) {
        //         return this.remove('', options);
        //     }
    };

    $.extend(this, publicAPI);
};

},{"../store/store-factory":36,"../transport/http-transport-factory":38,"../util/query-util":42,"./configuration-service":26}],28:[function(require,module,exports){
/**
 *
 * ##Member API Adapter
 *
 * The Member API Adapter provides methods to lookup user details or group details
 *
 *      var auth = new F.adapter.Member();
 *      auth.getGroupsByUser({ userId: 'b6b313a3-ab84-479c-baea-206f6bff337' });
 *      auth.getGroupDetails({ groupId: '00b53308-9833-47f2-b21e-1278c07d53b8' });
 */

'use strict';

var ConfigService = require('./configuration-service');
var TransportFactory = require('../transport/http-transport-factory');
var _pick = require('../util/object-util')._pick;
var apiEndpoint = 'member/local';

module.exports = function (config) {
    var defaults = {
        /**
         * Epicenter userId. Defaults to a blank string
         * @type { string}
         */
        userId: '',

        /**
         * Epicenter groupId. Defaults to a blank string
         * @type { string}
         */
        groupId: '',

        /**
         * Options to pass on to the underlying transport layer. All jquery.ajax options at http://api.jquery.com/jQuery.ajax/ are available. Defaults to empty object.
         * @type {object}
         */
        transport: {}
    };
    var serviceOptions = $.extend({}, defaults, config);
    var urlConfig = new ConfigService(serviceOptions).get('server');

    var transportOptions = $.extend(true, {}, serviceOptions.transport, {
        url: urlConfig.getAPIPath(apiEndpoint)
    });

    if (serviceOptions.token) {
        transportOptions.headers = {
            'Authorization': 'Bearer ' + serviceOptions.token
        };
    }
    var http = new TransportFactory(transportOptions, serviceOptions);

    var getFinalParams = function (params) {
        if (typeof params === 'object') {
            return $.extend(true, serviceOptions, params);
        }
        return serviceOptions;
    };

    var patchUserActiveField = function (params, active, options) {
        var httpOptions = $.extend(true, serviceOptions, options, {
            url: urlConfig.getAPIPath(apiEndpoint) + params.groupId + '/' + params.userId
        });

        return http.patch({ active: active }, httpOptions);
    };

    var publicAPI = {

        getGroupsByUser: function (params, options) {
            options = options || {};
            var httpOptions = $.extend(true, serviceOptions, options);
            var isString = typeof params === 'string';
            var objParams = getFinalParams(params);
            if (!isString && !objParams.userId) {
                throw new Error('No userId specified.');
            }

            var getParms = isString ? { userId: params } : _pick(objParams, 'userId');
            return http.get(getParms, httpOptions);
        },

        getGroupDetails: function (params, options) {
            options = options || {};
            var isString = typeof params === 'string';
            var objParams = getFinalParams(params);
            if (!isString && !objParams.groupId) {
                throw new Error('No groupId specified.');
            }

            var groupId = isString ? params : objParams.groupId;
            var httpOptions = $.extend(true, serviceOptions,
                options,
                { url: urlConfig.getAPIPath(apiEndpoint) + groupId }
            );

            return http.get({}, httpOptions);
        },

        makeUserActive: function (params, options) {
            return patchUserActiveField(params, true, options);
        },

        makeUserInactive: function (params, options) {
            return patchUserActiveField(params, false, options);
        }
    };

    $.extend(this, publicAPI);
};

},{"../transport/http-transport-factory":38,"../util/object-util":41,"./configuration-service":26}],29:[function(require,module,exports){
/**
 *
 * ##Run API Service
 *
 * The Run API Service allows you to perform common tasks around creating and updating runs, variables, and data.
 *
 * All API calls take in an "options" object as the last parameter. The options can be used to extend/override the Run API Service defaults.
 *
 * Typically, you first instantiate a [Run Manager](../run-manager/) and then access the Run Service that is automatically part of the manager.
 *
 *       var rm = new F.manager.RunManager({
 *           run: {
 *               account: 'acme-simulations',
 *               project: 'supply-chain-game',
 *               model: 'supply-chain-model.jl'
 *           }
 *       });
 *       rm.getRun()
 *           .then(function() {
 *               // the RunManager.run contains the instantiated Run Service,
 *               // so any Run Service method is valid here
 *               var rs = rm.run;
 *               rs.do('runModel');
 *       })
 *
 */

'use strict';

var ConfigService = require('./configuration-service');
var StorageFactory = require('../store/store-factory');
var qutil = require('../util/query-util');
var rutil = require('../util/run-util');
var _pick = require('../util/object-util')._pick;
var TransportFactory = require('../transport/http-transport-factory');
var VariablesService = require('./variables-api-service');

module.exports = function (config) {
    // config || (config = configService.get());
    var store = new StorageFactory({ synchronous: true });

    var defaults = {
        /**
         * For projects that require authentication, pass in the user access token (defaults to empty string). If the user is already logged in to Epicenter, the user access token is already set in a cookie and automatically loaded from there. (See [more background on access tokens](../../../project_access/)).
         * @see [Authentication API Service](../auth-api-service/) for getting tokens.
         * @type {String}
         */
        token: store.get('epicenter.project.token') || '',

        /**
         * The account id. In the Epicenter UI, this is the **Team ID** (for team projects) or **User ID** (for personal projects). Defaults to empty string.
         * @type {String}
         */
        account: '',

        /**
         * The project id. Defaults to empty string.
         * @type {String}
         */
        project: '',

        /**
         * Criteria by which to filter runs. Defaults to empty string.
         * @type {String}
         */
        filter: '',

        /**
         * Called when the call completes successfully. Defaults to `$.noop`.
         */
        success: $.noop,

        /**
         * Called when the call fails. Defaults to `$.noop`.
         */
        error: $.noop,

        /**
         * Options to pass on to the underlying transport layer. All jquery.ajax options at http://api.jquery.com/jQuery.ajax/ are available. Defaults to empty object.
         * @type {Object}
         */
        transport: {}
    };

    var serviceOptions = $.extend({}, defaults, config);

    var urlConfig = new ConfigService(serviceOptions).get('server');
    if (serviceOptions.account) {
        urlConfig.accountPath = serviceOptions.account;
    }
    if (serviceOptions.project) {
        urlConfig.projectPath = serviceOptions.project;
    }

    urlConfig.filter = ';';
    urlConfig.getFilterURL = function () {
        var url = urlConfig.getAPIPath('run');
        var filter = qutil.toMatrixFormat(serviceOptions.filter);

        if (filter) {
            url += filter + '/';
        }
        return url;
    };

    var httpOptions = $.extend(true, {}, serviceOptions.transport, {
        url: urlConfig.getFilterURL
    });

    if (serviceOptions.token) {
        httpOptions.headers = {
            'Authorization': 'Bearer ' + serviceOptions.token
        };
    }
    var http = new TransportFactory(httpOptions);

    var setFilterOrThrowError = function (options) {
        if (options.filter) {
            serviceOptions.filter = options.filter;
        }
        if (!serviceOptions.filter) {
            throw new Error('No filter specified to apply operations against');
        }
    };

    var publicAsyncAPI = {
        urlConfig: urlConfig,

        /**
         * Create a new run.
         *
         * NOTE: Typically this is not used! Use `RunManager.getRun()` with a `strategy` of `always-new`, or use `RunManager.reset()`. See [Run Manager](../run-manager/) for more details.
         *
         *  **Example**
         *
         *      rs.create('hello_world.jl');
         *
         *  **Parameters**
         * @param {String} `model` The name of the primary [model file](../../../writing_your_model/). This is the one file in the project that explicitly exposes variables and methods, and it must be stored in the Model folder of your Epicenter project.
         * @param {Object} `options` (Optional) Overrides for configuration options.
         *
         */
        create: function (params, options) {
            var createOptions = $.extend(true, {}, serviceOptions, options, { url: urlConfig.getAPIPath('run') });
            var runApiParams = ['model', 'scope', 'files'];
            if (typeof params === 'string') {
                // this is just the model name
                params = { model: params };
            } else {
                // whitelist the fields that we actually can send to the api
                params = _pick(params, runApiParams);
            }

            var oldSuccess = createOptions.success;
            createOptions.success = function (response) {
                serviceOptions.filter = response.id; //all future chained calls to operate on this id
                return oldSuccess.apply(this, arguments);
            };

            return http.post(params, createOptions);
        },

        /**
         * Returns particular runs, based on conditions specified in the `qs` object.
         *
         * The elements of the `qs` object are ANDed together within a single call to `.query()`.
         *
         * **Example**
         *
         *      // returns runs with saved = true and variables.price > 1,
         *      // where variables.price has been persisted (recorded)
         *      // in the model.
         *     rs.query({
         *          'saved': 'true',
         *          '.price': '>1'
         *       },
         *       {
         *          startrecord: 2,
         *          endrecord: 5
         *       });
         *
         * **Parameters**
         * @param {Object} `qs` Query object. Each key can be a property of the run or the name of variable that has been saved in the run (prefaced by `variables.`). Each value can be a literal value, or a comparison operator and value. (See [more on filtering](../../../rest_apis/aggregate_run_api/#filters) allowed in the underlying Run API.) Querying for variables is available for runs [in memory](../../../run_persistence/#runs-in-memory) and for runs [in the database](../../../run_persistence/#runs-in-memory) if the variables are persisted (e.g. that have been `record`ed in your Julia model).
         * @param {Object} `outputModifier` (Optional) Available fields include: `startrecord`, `endrecord`, `sort`, and `direction` (`asc` or `desc`).
         * @param {Object} `options` (Optional) Overrides for configuration options.
         */
        query: function (qs, outputModifier, options) {
            serviceOptions.filter = qs; //shouldn't be able to over-ride
            var httpOptions = $.extend(true, {}, serviceOptions, options);
            return http.get(outputModifier, httpOptions);
        },

        /**
         * Returns particular runs, based on conditions specified in the `qs` object.
         *
         * Similar to `.query()`.
         *
         * **Parameters**
         * @param {Object} `filter` Filter object. Each key can be a property of the run or the name of variable that has been saved in the run (prefaced by `variables.`). Each value can be a literal value, or a comparison operator and value. (See [more on filtering](../../../rest_apis/aggregate_run_api/#filters) allowed in the underlying Run API.) Filtering for variables is available for runs [in memory](../../../run_persistence/#runs-in-memory) and for runs [in the database](../../../run_persistence/#runs-in-memory) if the variables are persisted (e.g. that have been `record`ed in your Julia model).
         * @param {Object} `outputModifier` (Optional) Available fields include: `startrecord`, `endrecord`, `sort`, and `direction` (`asc` or `desc`).
         * @param {Object} `options` (Optional) Overrides for configuration options.
         */
        filter: function (filter, outputModifier, options) {
            if ($.isPlainObject(serviceOptions.filter)) {
                $.extend(serviceOptions.filter, filter);
            } else {
                serviceOptions.filter = filter;
            }
            var httpOptions = $.extend(true, {}, serviceOptions, options);
            return http.get(outputModifier, httpOptions);
        },

        /**
         * Get data for a specific run. This includes standard run data such as the account, model, project, and created and last modified dates. To request specific model variables, pass them as part of the `filters` parameter.
         *
         * Note that if the run is [in memory](../../../run_persistence/#runs-in-memory), any model variables are available; if the run is [in the database](../../../run_persistence/#runs-in-db), only model variables that have been persisted &mdash; that is, `record`ed in your Julia model &mdash; are available.
         *
         * **Example**
         *
         *     rs.load('bb589677-d476-4971-a68e-0c58d191e450', { include: ['.price', '.sales'] });
         *
         * **Parameters**
         * @param {String} `runID` The run id.
         * @param {Object} `filters` (Optional) Object containing filters and operation modifiers. Use key `include` to list model variables that you want to include in the response. Other available fields include: `startrecord`, `endrecord`, `sort`, and `direction` (`asc` or `desc`).
         * @param {Object} `options` (Optional) Overrides for configuration options.
         */
        load: function (runID, filters, options) {
            serviceOptions.filter = runID; //shouldn't be able to over-ride
            var httpOptions = $.extend(true, {}, serviceOptions, options);
            return http.get(filters, httpOptions);
        },


        //Saving data
        /**
         * Save attributes (data, model variables) of the run.
         *
         * **Examples**
         *
         *     rs.save({ completed: true });
         *     rs.save({ saved: true, variables: { a: 23, b: 23 } });
         *
         * **Parameters**
         * @param {Object} `attributes` The run data and variables to save. Model variables must be included in a `variables` field within the `attributes` object (otherwise they are treated as run data and added to the run record directly).
         * @param {Object} `options` (Optional) Overrides for configuration options.
         */
        save: function (attributes, options) {
            var httpOptions = $.extend(true, {}, serviceOptions, options);
            setFilterOrThrowError(httpOptions);
            return http.patch(attributes, httpOptions);
        },

        //##Operations
        /**
         * Call a method from the model.
         *
         * Depending on the language in which you have written your model, the method may need to be exposed (e.g. `export` for a Julia model) in the model file in order to be called through the API. See [Writing your Model](../../../writing_your_model/)).
         *
         * The `params` argument is normally an array of arguments to the `operation`. In the special case where `operation` only takes one argument, you are not required to put that argument into an array.
         *
         * Note that you can combine the `operation` and `params` arguments into a single object if you prefer, as in the last example.
         *
         * **Examples**
         *
         *      // method "solve" takes no arguments
         *     rs.do('solve');
         *      // method "echo" takes one argument, a string
         *     rs.do('echo', ['hello']);
         *      // method "echo" takes one argument, a string
         *     rs.do('echo', 'hello');
         *      // method "sumArray" takes one argument, an array
         *     rs.do('sumArray', [[4,2,1]]);
         *      // method "add" takes two arguments, both integers
         *     rs.do({ name:'add', params:[2,4] });
         *
         * **Parameters**
         * @param {String} `operation` Name of method.
         * @param {Array} `params` (Optional) Any parameters the operation takes, passed as an array. In the special case where `operation` only takes one argument, you are not required to put that argument into an array, and can just pass it directly.
         * @param {Object} `options` (Optional) Overrides for configuration options.
         */
        do: function (operation, params, options) {
            // console.log('do', operation, params);
            var opsArgs;
            var postOptions;
            if (options) {
                opsArgs = params;
                postOptions = options;
            } else {
                if ($.isPlainObject(params)) {
                    opsArgs = null;
                    postOptions = params;
                } else {
                    opsArgs = params;
                }
            }
            var result = rutil.normalizeOperations(operation, opsArgs);
            var httpOptions = $.extend(true, {}, serviceOptions, postOptions);

            setFilterOrThrowError(httpOptions);

            var prms = (result.args[0].length && (result.args[0] !== null && result.args[0] !== undefined)) ? result.args[0] : [];
            return http.post({ arguments: prms }, $.extend(true, {}, httpOptions, {
                url: urlConfig.getFilterURL() + 'operations/' + result.ops[0] + '/'
            }));
        },

        /**
         * Call several methods from the model, sequentially.
         *
         * Depending on the language in which you have written your model, the methods may need to be exposed (e.g. `export` for a Julia model) in the model file in order to be called through the API. See [Writing your Model](../../../writing_your_model/)).
         *
         * **Examples**
         *
         *      // methods "initialize" and "solve" do not take any arguments
         *     rs.serial(['initialize', 'solve']);
         *      // methods "init" and "reset" take two arguments each
         *     rs.serial([  { name: 'init', params: [1,2] },
         *                  { name: 'reset', params: [2,3] }]);
         *      // method "init" takes two arguments,
         *      // method "runmodel" takes none
         *     rs.serial([  { name: 'init', params: [1,2] },
         *                  { name: 'runmodel', params: [] }]);
         *
         * **Parameters**
         * @param {Array[String]|Array[Object]} `operations` If none of the methods take parameters, pass an array of the method names (strings). If any of the methods do take parameters, pass an array of objects, each of which contains a method name and its own (possibly empty) array of parameters.
         * @param {Object} `options` (Optional) Overrides for configuration options.
         */
        serial: function (operations, params, options) {
            var opParams = rutil.normalizeOperations(operations, params);
            var ops = opParams.ops;
            var args = opParams.args;
            var me = this;

            var $d = $.Deferred();
            var postOptions = $.extend(true, {}, serviceOptions, options);

            var doSingleOp = function () {
                var op = ops.shift();
                var arg = args.shift();

                me.do(op, arg, {
                    success: function () {
                        if (ops.length) {
                            doSingleOp();
                        } else {
                            $d.resolve.apply(this, arguments);
                            postOptions.success.apply(this, arguments);
                        }
                    },
                    error: function () {
                        $d.reject.apply(this, arguments);
                        postOptions.error.apply(this, arguments);
                    }
                });
            };

            doSingleOp();

            return $d.promise();
        },

        /**
         * Call several methods from the model, executing them in parallel.
         *
         * Depending on the language in which you have written your model, the methods may need to be exposed (e.g. `export` for a Julia model) in the model file in order to be called through the API. See [Writing your Model](../../../writing_your_model/)).
         *
         * **Example**
         *
         *      // methods "solve" and "reset" do not take any arguments
         *     rs.parallel(['solve', 'reset']);
         *      // methods "add" and "subtract" take two arguments each
         *     rs.parallel([ { name: 'add', params: [1,2] },
         *                   { name: 'subtract', params:[2,3] }]);
         *      // methods "add" and "subtract" take two arguments each
         *     rs.parallel({ add: [1,2], subtract: [2,4] });
         *
         * **Parameters**
         * @param {Array|Object} `operations` If none of the methods take parameters, pass an array of the method names (as strings). If any of the methods do take parameters, you have two options. You can pass an array of objects, each of which contains a method name and its own (possibly empty) array of parameters. Alternatively, you can pass a single object with the method name and a (possibly empty) array of parameters.
         * @param {Object} `options` (Optional) Overrides for configuration options.
         */
        parallel: function (operations, params, options) {
            var $d = $.Deferred();

            var opParams = rutil.normalizeOperations(operations, params);
            var ops = opParams.ops;
            var args = opParams.args;
            var postOptions = $.extend(true, {}, serviceOptions, options);

            var queue  = [];
            for (var i = 0; i< ops.length; i++) {
                queue.push(
                    this.do(ops[i], args[i])
                );
            }
            $.when.apply(this, queue)
                .done(function () {
                    $d.resolve.apply(this, arguments);
                    postOptions.success.apply(this.arguments);
                })
                .fail(function () {
                    $d.reject.apply(this, arguments);
                    postOptions.error.apply(this.arguments);
                });

            return $d.promise();
        }
    };

    var publicSyncAPI = {
        /**
         * Returns a Variables Service instance. Use the variables instance to load, save, and query for specific model variables. See the [Variable API Service](../variables-api-service/) for more information.
         *
         * **Example**
         *
         *      var vs = rs.variables();
         *      vs.save({ sample_int: 4});
         *
         * **Parameters**
         * @param {Object} `config` (Optional) Overrides for configuration options.
         */

        variables: function (config) {
            var vs = new VariablesService($.extend(true, {}, serviceOptions, config, {
                runService: this
            }));
            return vs;
        }
    };

    $.extend(this, publicAsyncAPI);
    $.extend(this, publicSyncAPI);
};


},{"../store/store-factory":36,"../transport/http-transport-factory":38,"../util/object-util":41,"../util/query-util":42,"../util/run-util":43,"./configuration-service":26,"./variables-api-service":33}],30:[function(require,module,exports){
'use strict';
/**
 * ##State API Adapter
 *
 * The State API Adapter allows you to replay or clone runs
 *
 */

var ConfigService = require('./configuration-service');
var TransportFactory = require('../transport/http-transport-factory');
var _pick = require('../util/object-util')._pick;
var apiEndpoint = 'model/state';

module.exports = function (config) {

    var defaults = {

    };

    var serviceOptions = $.extend({}, defaults, config);
    var urlConfig = new ConfigService(serviceOptions).get('server');

    var transportOptions = $.extend(true, {}, serviceOptions.transport, {
        url: urlConfig.getAPIPath(apiEndpoint)
    });

    if (serviceOptions.token) {
        transportOptions.headers = {
            'Authorization': 'Bearer ' + serviceOptions.token
        };
    }

    var http = new TransportFactory(transportOptions);

    var publicAPI = {
        /**
        * Replays a run to get it back into memory
        *
        *
        * **PARAMETERS**
        * @param {object} `params` Parameters object
        * @param {string} `params.runId` id of the run to bring back to memory
        * @param {string} (Optional) `param.stopBefore` - the run is advanced only up to the first occurrence of that method
        * @param {object} (Optional) `options` - Options override
        */
        replay: function (params, options) {
            var replayOptions = $.extend(true, {},
                serviceOptions,
                options,
                { url: urlConfig.getAPIPath(apiEndpoint) + params.runId }
            );

            params = $.extend(true, { action: 'replay' }, _pick(params, 'stopBefore'));

            return http.post(params, replayOptions);
        },

        /**
        * Clones a given run and returns a new run in the same state as the given run
        *
        *
        * **PARAMETERS**
        * @param {object} `params` Parameters object
        * @param {string} `params.runId` id of the run to bring back to memory
        * @param {string} (Optional) `param.stopBefore` - the run is advanced only up to the first occurrence of that method
        * @param {object} (Optional) `options` - Options override
        */
        clone: function (params, options) {
            var replayOptions = $.extend(true, {},
                serviceOptions,
                options,
                { url: urlConfig.getAPIPath(apiEndpoint) + params.runId }
            );

            params = $.extend(true, { action: 'clone' }, _pick(params, 'stopBefore'));

            return http.post(params, replayOptions);
        }
    };

    $.extend(this, publicAPI);
};
},{"../transport/http-transport-factory":38,"../util/object-util":41,"./configuration-service":26}],31:[function(require,module,exports){
'use strict';

module.exports = function (config) {
    //TODO: urlutils to get host, since no window on node

    var API_PROTOCOL = 'https';
    var HOST_API_MAPPING = {
        'forio.com': 'api.forio.com',
        'foriodev.com': 'api.epicenter.foriodev.com'
    };

    var publicExports = {
        protocol: API_PROTOCOL,

        api: '',

        host: (function () {
            var host = window.location.host;
            if (!host || host.indexOf('local') !== -1) {
                host = 'forio.com';
            }
            return (HOST_API_MAPPING[host]) ? HOST_API_MAPPING[host] : 'api.' + host;
        }()),

        appPath: (function () {
            var path = window.location.pathname.split('\/');

            return path && path[1] || '';
        }()),

        accountPath: (function () {
            var accnt = '';
            var path = window.location.pathname.split('\/');
            if (path && path[1] === 'app') {
                accnt = path[2];
            }
            return accnt;
        }()),

        projectPath: (function () {
            var prj = '';
            var path = window.location.pathname.split('\/');
            if (path && path[1] === 'app') {
                prj = path[3];
            }
            return prj;
        }()),

        getAPIPath: function (api) {
            var PROJECT_APIS = ['run', 'data'];
            var apiPath = this.protocol + '://' + this.host + '/' + api + '/';

            if ($.inArray(api, PROJECT_APIS) !== -1) {
                apiPath += this.accountPath + '/' + this.projectPath  + '/';
            }
            return apiPath;
        }
    };

    $.extend(publicExports, config);
    return publicExports;
};

},{}],32:[function(require,module,exports){
'use strict';
/**
* ##User API Adapter
*
* The user API adapter allows you to quert the /user API
*
*
*/

var ConfigService = require('./configuration-service');
var TransportFactory = require('../transport/http-transport-factory');
var qutil = require('../util/query-util');

module.exports = function (config) {
    var defaults = {

       account: '',

       token: '',

        //Options to pass on to the underlying transport layer
        transport: {}
    };

    var serviceOptions = $.extend({}, defaults, config);
    var urlConfig = new ConfigService(serviceOptions).get('server');
    var transportOptions = $.extend(true, {}, serviceOptions.transport, {
        url: urlConfig.getAPIPath('user')
    });

    if (serviceOptions.token) {
        transportOptions.headers = {
            'Authorization': 'Bearer ' + serviceOptions.token
        };
    }

    var http = new TransportFactory(transportOptions);

    var publicAPI = {
        get: function (filter, options) {
            options = options || {};
            filter = filter || {};

            var getOptions = $.extend(true, {},
                serviceOptions,
                options
            );

            var toQFilter = function (filter) {
                var res = {};

                // API only supports filtering by username for now
                if (filter.userName) {
                    res.q = filter.userName;
                }

                return res;
            };

            var toIdFilters = function (id) {
                if (!id) {
                    return '';
                }

                id = $.isArray(id) ? id : [id];
                return 'id=' + id.join('&id=');
            };

            var getFilters = [
                'account=' + getOptions.account,
                toIdFilters(filter.id),
                qutil.toQueryFormat(toQFilter(filter))
            ].join('&');

            // special case for queries with large number of ids
            // make it as a post with GET semantics
            var threshold = 30;
            if (filter.id && $.isArray(filter.id) && filter.id.length >= threshold) {
                getOptions.url = urlConfig.getAPIPath('user') + '?_method=GET';
                return http.post({ id: filter.id }, getOptions);
            } else {
                return http.get(getFilters, getOptions);
            }
        },

        getById: function (userId, options) {
            return publicAPI.get({ id: userId }, options);
        }
    };

    $.extend(this, publicAPI);
};





},{"../transport/http-transport-factory":38,"../util/query-util":42,"./configuration-service":26}],33:[function(require,module,exports){
/**
 *
 * ##Variables API Service
 *
 * Used in conjunction with the [Run API Service](../run-api-service/) to read, write, and search for specific model variables.
 *
 *     var rm = new F.manager.RunManager({
 *           run: {
 *               account: 'acme-simulations',
 *               project: 'supply-chain-game',
 *               model: 'supply-chain-model.jl'
 *           }
 *      });
 *     rm.getRun()
 *       .then(function() {
 *          var vs = rm.run.variables();
 *          vs.save({sample_int: 4});
 *        });
 *
 */


 'use strict';

 var TransportFactory = require('../transport/http-transport-factory');

module.exports = function (config) {
    var defaults = {
        /**
         * The runs object to which the variable filters apply. Defaults to null.
         * @type {runService}
         */
        runService: null
    };
    var serviceOptions = $.extend({}, defaults, config);

    var getURL = function () {
        return serviceOptions.runService.urlConfig.getFilterURL() + 'variables/';
    };

    var httpOptions = {
        url: getURL
    };
    if (serviceOptions.token) {
        httpOptions.headers = {
            'Authorization': 'Bearer ' + serviceOptions.token
        };
    }
    var http = new TransportFactory(httpOptions);

    var publicAPI = {

        /**
         * Get values for a variable.
         *
         * **Example**
         *
         *      vs.load('sample_int');
         *
         * **Parameters**
         * @param {String} `variable` Name of variable to load.
         * @param {Object} `outputModifier` (Optional) Available fields include: `startrecord`, `endrecord`, `sort`, and `direction` (`asc` or `desc`).
         * @param {Object} `options` (Optional) Overrides for configuration options.
         */
        load: function (variable, outputModifier, options) {
            var httpOptions = $.extend(true, {}, serviceOptions, options);
            return http.get(outputModifier, $.extend({}, httpOptions, {
                url: getURL() + variable + '/'
            }));
        },

        /**
         * Returns particular variables, based on conditions specified in the `query` object.
         *
         * **Example**
         *
         *      vs.query(['price', 'sales']);
         *      vs.query({ include:['price', 'sales'] });
         *
         * **Parameters**
         * @param {Object|Array} `query` The names of the variables requested.
         * @param {Object} `outputModifier` (Optional) Available fields include: `startrecord`, `endrecord`, `sort`, and `direction` (`asc` or `desc`).
         * @param {Object} `options` (Optional) Overrides for configuration options.
         *
         */
        query: function (query, outputModifier, options) {
            //Query and outputModifier are both querystrings in the url; only calling them out separately here to be consistent with the other calls
            var httpOptions = $.extend(true, {}, serviceOptions, options);

            if ($.isArray(query)) {
                query = { include: query };
            }
            $.extend(query, outputModifier);
            return http.get(query, httpOptions);
        },

        /**
         * Save values to model variables. Overwrites existing values. Note that you can only update model variables if the run is [in memory](../../../run_persistence/#runs-in-memory). (An alternate way to update model variables is to call a method from the model and make sure that the method persists the variables. See `do`, `serial`, and `parallel` in the [Run API Service](../run-api-service/) for calling methods from the model.)
         *
         * **Example**
         *
         *      vs.save('price', 4);
         *      vs.save({ price: 4, quantity: 5, products: [2,3,4] });
         *
         * **Parameters**
         * @param {Object|String} `variable` An object composed of the model variables and the values to save. Alternatively, a string with the name of the variable.
         * @param {Object} `val` (Optional) If passing a string for `variable`, use this argument for the value to save.
         * @param {Object} `options` (Optional) Overrides for configuration options.
         */
        save: function (variable, val, options) {
            var attrs;
            if (typeof variable === 'object') {
                attrs = variable;
                options = val;
            } else {
                (attrs = {})[variable] = val;
            }
            var httpOptions = $.extend(true, {}, serviceOptions, options);

            return http.patch.call(this, attrs, httpOptions);
        }

        // Not Available until underlying API supports PUT. Otherwise save would be PUT and merge would be PATCH
        // *
        //  * Save values to the api. Merges arrays, but otherwise same as save
        //  * @param {Object|String} variable Object with attributes, or string key
        //  * @param {Object} val Optional if prev parameter was a string, set value here
        //  * @param {Object} options Overrides for configuration options
        //  *
        //  * @example
        //  *     vs.merge({ price: 4, quantity: 5, products: [2,3,4] })
        //  *     vs.merge('price', 4);

        // merge: function (variable, val, options) {
        //     var attrs;
        //     if (typeof variable === 'object') {
        //       attrs = variable;
        //       options = val;
        //     } else {
        //       (attrs = {})[variable] = val;
        //     }
        //     var httpOptions = $.extend(true, {}, serviceOptions, options);

        //     return http.patch.call(this, attrs, httpOptions);
        // }
    };
    $.extend(this, publicAPI);
};

},{"../transport/http-transport-factory":38}],34:[function(require,module,exports){
/**
 * ##World API Adapter
 *
 * A [run](../../../glossary/#run) is a collection of end user interactions with a project and its model -- including setting variables, making decisions, and calling operations. For building multiplayer simulations you typically want multiple end users to share the same set of interactions, and work within a common state. Epicenter allows you to create "worlds" to handle such cases.
 *
 * The World API Adapter allows you to create, access, and manipulate multiplayer worlds within your Epicenter project. You can use this to add and remove end users from the world, and to create, access, and remove their runs. (The related [World Manager](../world-manager/) provides an easy way to access runs and worlds for particular users.) Only [team projects](../../../glossary/#team) can be multiplayer.
 *
 * As with all the other [API Adapters](../../), all methods take in an "options" object as the last parameter. The options can be used to extend/override the World API Service defaults.
 *
 * Typically, you instantiate a World Adapter and then access the methods provided. Instantiating requires the account id (**Team ID** in the Epicenter user interface), project id (**Project ID**), and group (**Group Name**).
 *
 *       var wa = new F.service.World({
 *          account: 'acme-simulations',
 *          project: 'supply-chain-game',
 *          group: 'team1' });
 *       wa.create()
 *          .then(function(world) {
 *              // call methods, e.g. wa.addUsers()
 *          });
 */

'use strict';

var ConfigService = require('./configuration-service');
var StorageFactory = require('../store/store-factory');
// var qutil = require('../util/query-util');
var TransportFactory = require('../transport/http-transport-factory');
var _pick = require('../util/object-util')._pick;

var apiBase = 'multiplayer/';
var assignmentEndpoint = apiBase + 'assign';
var apiEndpoint = apiBase + 'world';
var projectEndpoint = apiBase + 'project';

module.exports = function (config) {
    var store = new StorageFactory({ synchronous: true });

    var defaults = {
        /**
         * For projects that require authentication, pass in the user access token (defaults to empty string). If the user is already logged in to Epicenter, the user access token is already set in a cookie and automatically loaded from there. (See [more background on access tokens](../../../project_access/)).
         * @see [Authentication API Service](../auth-api-service/) for getting tokens.
         * @type {String}
         */
       token: store.get('epicenter.project.token') || '',

        /**
         * The project id. Defaults to undefined.
         * @type {String}
         */
       project: undefined,

        /**
         * The account id. In the Epicenter UI, this is the **Team ID** (for team projects). Defaults to undefined.
         * @type {String}
         */
       account: undefined,

        /**
         * The group name. Defaults to undefined.
         * @type {String}
         */
       group: undefined,

       /**
         * The model file to use to create runs in this world. Defaults to undefined.
         * @type {String}
         */
        model: undefined,

//        apiKey: '',

//        domain: 'forio.com',

        /**
         * Options to pass on to the underlying transport layer. All jquery.ajax options at http://api.jquery.com/jQuery.ajax/ are available. Defaults to empty object.
         * @type {Object}
         */
        transport: {},

        /**
         * Called when the call completes successfully. Defaults to `$.noop`.
         */
        success: $.noop,

        /**
         * Called when the call fails. Defaults to `$.noop`.
         */
        error: $.noop
    };

    var serviceOptions = $.extend({}, defaults, config);
    var urlConfig = new ConfigService(serviceOptions).get('server');

    if (!serviceOptions.account) {
        serviceOptions.account = urlConfig.accountPath;
    }

    if (!serviceOptions.project) {
        serviceOptions.project = urlConfig.projectPath;
    }

    var transportOptions = $.extend(true, {}, serviceOptions.transport, {
        url: urlConfig.getAPIPath(apiEndpoint)
    });

    if (serviceOptions.token) {
        transportOptions.headers = {
            'Authorization': 'Bearer ' + serviceOptions.token
        };
    }

    var http = new TransportFactory(transportOptions);

    var setIdFilterOrThrowError = function (options) {
        if (options.filter) {
            serviceOptions.filter = options.filter;
        }
        if (!serviceOptions.filter) {
            throw new Error('No filter specified to apply operations against');
        }
    };

    var validateModelOrThrowError = function (options) {
        if (!options.model) {
            throw new Error('No model specified to get the current run');
        }
    };

    var publicAPI = {

        /**
        * Create a new World.
        *
        *  **Example**
        *
        *      var wa = new F.service.World({
        *           account: 'acme-simulations',
        *           project: 'supply-chain-game',
        *           group: 'team1' });
        *      wa.create({
        *           roles: ['VP Marketing', 'VP Sales', 'VP Engineering']
        *       });
        *
        *  **Parameters**
        * @param {object} `params` Parameters to create the world.
        * @param {string} `params.group` (Optional) The **Group Name** to create this world under. Only end users in this group are eligible to join the world. Optional here; required when instantiating the service (new F.service.World()).
        * @param {object} `params.roles` (Optional) The list of roles (strings) for this world. Some worlds have specific roles that **must** be filled by end users. Listing the roles allows you to autoassign users to worlds and ensure that all roles are filled in each world.
        * @param {object} `params.optionalRoles` (Optional) The list of optional roles (strings) for this world. Some worlds have specific roles that **may** be filled by end users. Listing the optional roles as part of the world object allows you to autoassign users to worlds and ensure that all roles are filled in each world.
        * @param {integer} `params.minUsers` (Optional) The minimum number of users for the world. Including this number allows you to autoassign end users to worlds and ensure that the correct number of users are in each world.
        * @param {object} `options` (Optional) Options object to override global options.
        *
        */
        create: function (params, options) {
            var createOptions = $.extend(true, {}, serviceOptions, options, { url: urlConfig.getAPIPath(apiEndpoint) });
            var worldApiParams = ['scope', 'files', 'roles', 'optionalRoles', 'minUsers', 'group', 'name'];
            // whitelist the fields that we actually can send to the api
            params = _pick(params, worldApiParams);

            // account and project go in the body, not in the url
            $.extend(params, _pick(serviceOptions, ['account', 'project', 'group']));

            var oldSuccess = createOptions.success;
            createOptions.success = function (response) {
                serviceOptions.filter = response.id; //all future chained calls to operate on this id
                return oldSuccess.apply(this, arguments);
            };

            return http.post(params, createOptions);
        },

        /**
        * Update a World, for example to add the roles to the world.
        *
        *  **Example**
        *
        *      var wa = new F.service.World({
        *           account: 'acme-simulations',
        *           project: 'supply-chain-game',
        *           group: 'team1' });
        *      wa.create();
        *           .then(function(world) {
        *               wa.update({ roles: ['VP Marketing', 'VP Sales', 'VP Engineering'] });
        *           });
        *
        *  **Parameters**
        * @param {object} `params` Parameters to update the world.
        * @param {string} `params.name` A string identifier for the linked end users, for example, "name": "Our Team".
        * @param {object} `params.roles` (Optional) The list of roles (strings) for this world. Some worlds have specific roles that **must** be filled by end users. Listing the roles allows you to autoassign users to worlds and ensure that all roles are filled in each world.
        * @param {object} `params.optionalRoles` (Optional) The list of optional roles (strings) for this world. Some worlds have specific roles that **may** be filled by end users. Listing the optional roles as part of the world object allows you to autoassign users to worlds and ensure that all roles are filled in each world.
        * @param {integer} `params.minUsers` (Optional) The minimum number of users for the world. Including this number allows you to autoassign end users to worlds and ensure that the correct number of users are in each world.
        * @param {object} `options` (Optional) Options object to override global options.
        *
        */
        update: function (params, options) {
            var whitelist = ['roles', 'optionalRoles', 'minUsers'];
            options = options || {};
            setIdFilterOrThrowError(options);

            var updateOptions = $.extend(true, {},
                serviceOptions,
                options,
                { url: urlConfig.getAPIPath(apiEndpoint) + serviceOptions.filter }
            );

            params = _pick(params || {}, whitelist);

            return http.patch(params, updateOptions);
        },

        /**
        * Delete an existing world.
        *
        *  **Example**
        *
        *      var wa = new F.service.World({
        *           account: 'acme-simulations',
        *           project: 'supply-chain-game',
        *           group: 'team1' });
        *      wa.create();
        *           .then(function(world) {
        *               wa.delete();
        *           });
        *
        *  **Parameters**
        * @param {object} `options` (Optional) Options object to override global options.
        *
        */
        delete: function (options) {
            options = options || {};
            setIdFilterOrThrowError(options);

            var deleteOptions = $.extend(true, {},
                serviceOptions,
                options,
                { url: urlConfig.getAPIPath(apiEndpoint) + serviceOptions.filter }
            );

            return http.delete(null, deleteOptions);
        },

        /**
        * Updates the configuration for the current instance of the world adapter
        *
        * **Example**
        * var ws = new F.service.World({...}).updateConfig({ filter: '123' }).addUser({ userId: '123' });
        *
        *
        */
        updateConfig: function (config) {
            $.extend(serviceOptions, config);

            return this;
        },

        /**
        * List all worlds for a given account, project, and group. All three are required, and if not specified as parameters, are read from the service.
        *
        *  **Example**
        *
        *      var wa = new F.service.World({
        *           account: 'acme-simulations',
        *           project: 'supply-chain-game',
        *           group: 'team1' });
        *      wa.create();
        *           .then(function(world) {
        *               // lists all worlds in group "team1"
        *               wa.list();
        *
        *               // lists all worlds in group "other-group-name"
        *               wa.list({ group: 'other-group-name' });
        *           });
        *
        *  **Parameters**
        * @param {object} `options` (Optional) Options object to override global options.
        *
        */
        list: function (options) {
            options = options || {};

            var getOptions = $.extend(true, {},
                serviceOptions,
                options,
                { url: urlConfig.getAPIPath(apiEndpoint) }
            );

            var filters = _pick(getOptions, ['account', 'project', 'group']);

            return http.get(filters, getOptions);
        },

        /**
        * Get all worlds that an end user belongs to for a given account, project, and group.
        *
        *  **Example**
        *
        *      var wa = new F.service.World({
        *           account: 'acme-simulations',
        *           project: 'supply-chain-game',
        *           group: 'team1' });
        *      wa.create();
        *           .then(function(world) {
        *               wa.getWorldsForUser('b1c19dda-2d2e-4777-ad5d-3929f17e86d3')
        *           });
        *
        * ** Parameters **
        * @param {string} `userId` The `userId` of the user whose worlds are being retrieved.
        * @param {object} `options` (Optional) Options object to override global options.
        */
        getWorldsForUser: function (userId, options) {
            options = options || {};

            var getOptions = $.extend(true, {},
                serviceOptions,
                options,
                { url: urlConfig.getAPIPath(apiEndpoint) }
            );

            var filters = $.extend(
                _pick(getOptions, ['account', 'project', 'group']),
                { userId: userId }
            );

            return http.get(filters, getOptions);
        },

        /**
        * Add an end user or list of end users to a given world. The end user must be a member of the `group` that is associated with this world.
        *
        *  **Example**
        *
        *      var wa = new F.service.World({
        *           account: 'acme-simulations',
        *           project: 'supply-chain-game',
        *           group: 'team1' });
        *      wa.create();
        *           .then(function(world) {
        *               // add one user
        *               wa.addUsers('b1c19dda-2d2e-4777-ad5d-3929f17e86d3');
        *               wa.addUsers(['b1c19dda-2d2e-4777-ad5d-3929f17e86d3']);
        *               wa.addUsers({ userId: 'b1c19dda-2d2e-4777-ad5d-3929f17e86d3', role: 'VP Sales' });
        *
        *               // add several users
        *               wa.addUsers([
        *                   { userId: 'a6fe0c1e-f4b8-4f01-9f5f-01ccf4c2ed44',
        *                     role: 'VP Marketing' },
        *                   { userId: '8f2604cf-96cd-449f-82fa-e331530734ee',
        *                     role: 'VP Engineering' }
        *               ]);
        *
        *               // add one user to a specific world
        *               wa.addUsers('b1c19dda-2d2e-4777-ad5d-3929f17e86d3', world.id);
        *               wa.addUsers('b1c19dda-2d2e-4777-ad5d-3929f17e86d3', { filter: world.id });
        *           });
        *
        * ** Parameters **
        * @param {string|object|array} `users` User id, array of user ids, object, or array of objects of the users to add to this world.
        * @param {string} `users.role` The `role` the user should have in the world. It is up to the caller to ensure, if needed, that the `role` passed in is one of the `roles` or `optionalRoles` of this world.
        * @param {string} `worldId` The world to which the users should be added. If not specified, the filter parameter of the `options` object is used.
        * @param {object} `options` (Optional) Options object to override global options.
        */
        addUsers: function (users, worldId, options) {

            if (!users) {
                throw new Error('Please provide a list of users to add to the world');
            }

            // normalize the list of users to an array of user objects
            users = $.map([].concat(users), function (u) {
                var isObject = $.isPlainObject(u);

                if (typeof u !== 'string' && !isObject) {
                    throw new Error('Some of the users in the list are not in the valid format: ' + u);
                }

                return isObject ? u : { userId: u };
            });

            // check if options were passed as the second parameter
            if ($.isPlainObject(worldId) && !options) {
                options = worldId;
                worldId = null;
            }

            options = options || {};

            // we must have options by now
            if (typeof worldId === 'string') {
                options.filter = worldId;
            }

            setIdFilterOrThrowError(options);

            var updateOptions = $.extend(true, {},
                serviceOptions,
                options,
                { url: urlConfig.getAPIPath(apiEndpoint) + serviceOptions.filter + '/users' }
            );

            return http.post(users, updateOptions);
        },

        /**
        * Updates a user from a given world (only one user at a time)
        *
        * Supported formats:
        * ws.updateUser({ userId: 'b1c19dda-2d2e-4777-ad5d-3929f17e86d3', role: 'leader' });
        *
        * @param user {object} user object with userId and the new role
        * @param options {object} (Optional) Options object to override global options
        *
        */
        updateUser: function (user, options) {
            options = options || {};

            if (!user || !user.userId) {
                throw new Error('You need to pass a userId to update from the world');
            }

            setIdFilterOrThrowError(options);

            var patchOptions = $.extend(true, {},
                serviceOptions,
                options,
                { url: urlConfig.getAPIPath(apiEndpoint) + serviceOptions.filter + '/users/' + user.userId }
            );

            return http.patch(_pick(user, 'role'), patchOptions);
        },

        /**
        * Remove an end user from a given world.
        *
        *  **Example**
        *
        *      var wa = new F.service.World({
        *           account: 'acme-simulations',
        *           project: 'supply-chain-game',
        *           group: 'team1' });
        *      wa.create();
        *           .then(function(world) {
        *               wa.addUsers(
        *                   { userId: 'a6fe0c1e-f4b8-4f01-9f5f-01ccf4c2ed44' },
        *                   { userId: '8f2604cf-96cd-449f-82fa-e331530734ee' }
        *               );
        *               wa.removeUser('a6fe0c1e-f4b8-4f01-9f5f-01ccf4c2ed44');
        *               wa.removeUser({ userId: '8f2604cf-96cd-449f-82fa-e331530734ee' });
        *           });
        *
        * ** Parameters **
        * @param {object|string} `user` The `userId` of the user to remove from the world, or an object containing the `userId` field.
        * @param {object} `options` (Optional) Options object to override global options.
        */
        removeUser: function (user, options) {
            options = options || {};

            if (typeof user === 'string') {
                user = { userId: user };
            }

            if (!user.userId) {
                throw new Error('You need to pass a userId to remove from the world');
            }

            setIdFilterOrThrowError(options);

            var getOptions = $.extend(true, {},
                serviceOptions,
                options,
                { url: urlConfig.getAPIPath(apiEndpoint) + serviceOptions.filter + '/users/' + user.userId }
            );

            return http.delete(null, getOptions);
        },

        /**
        * Gets the run id of current run for the given world. If the world does not have a run, creates a new one and returns the run id.
        *
        * Remember that a [run](../../glossary/#run) is a collection of interactions with a project and its model. In the case of multiplayer projects, the run is shared by all end users in the world.
        *
        *  **Example**
        *
        *      var wa = new F.service.World({
        *           account: 'acme-simulations',
        *           project: 'supply-chain-game',
        *           group: 'team1' });
        *      wa.create();
        *           .then(function(world) {
        *               wa.getCurrentRunId({ model: 'model.py' });
        *           });
        *
        * ** Parameters **
        * @param {object} `options` (Optional) Options object to override global options.
        * @param {object} `options.model` The model file to use to create a run if needed.
        */
        getCurrentRunId: function (options) {
            options = options || {};

            setIdFilterOrThrowError(options);

            var getOptions = $.extend(true, {},
                serviceOptions,
                options,
                { url: urlConfig.getAPIPath(apiEndpoint) + serviceOptions.filter + '/run' }
            );

            validateModelOrThrowError(getOptions);
            return http.post(_pick(getOptions, 'model'), getOptions);
        },

        /**
        * Gets the current (most recent) world for the given end user in the given group. Brings this most recent world into memory if needed.
        *
        *  **Example**
        *
        *      var wa = new F.service.World({
        *           account: 'acme-simulations',
        *           project: 'supply-chain-game',
        *           group: 'team1' });
        *      wa.create();
        *           .then(function(world) {
        *               wa.getCurrentWorldForUser('8f2604cf-96cd-449f-82fa-e331530734ee');
        *           });
        *
        * ** Parameters **
        * @param {string} `userId` The `userId` of the user whose current (most recent) world is being retrieved.
        * @param {string} `groupName` (Optional) The name of the group. If not provided, defaults to the group used to create the service.
        */
        getCurrentWorldForUser: function (userId, groupName) {
            var dtd = $.Deferred();
            var me = this;
            this.getWorldsForUser(userId, { group: groupName })
                .then(function (worlds) {
                    // assume the most recent world as the 'active' world
                    worlds.sort(function (a, b) { return new Date(b.lastModified) - new Date(a.lastModified); });
                    var currentWorld = worlds[0];

                    if (currentWorld) {
                        serviceOptions.filter =  currentWorld.id;
                    }

                    dtd.resolve(currentWorld, me);
                })
                .fail(dtd.reject);

            return dtd.promise();
        },

        /**
        * Deletes the current run from the world.
        *
        *  **Example**: This method is not yet implemented.
        *
        *  **Parameters**
        * @param {string} `worldId`
        * @param {object} `options` (Optional) Options object to override global options.
        */
        deleteRun: function (worldId, options) {
            options = options || {};

            if (worldId) {
                options.filter = worldId;
            }

            setIdFilterOrThrowError(options);

            var deleteOptions = $.extend(true, {},
                serviceOptions,
                options,
                { url: urlConfig.getAPIPath(apiEndpoint) + serviceOptions.filter + '/run' }
            );

            return http.delete(null, deleteOptions);
        },

        /**
        * Creates a new run for the world.
        *
        *  **Example**: This method is not yet implemented.
        *
        *  **Parameters**
        * @param {string} `worldId` worldId in which we create the new Run.
        * @param {object} `options` (Optional) Options object to override global options.
        */
        newRunForWorld: function (worldId, options) {
            var currentRunOptions = $.extend(true, {},
                options,
                { filter: worldId }
            );
            validateModelOrThrowError(currentRunOptions);
            return this.deleteRun(worldId, options)
                .then(function () {
                    return this.getCurrentRunId(currentRunOptions);
                });
        },

        /**
        * autoAssign users to worlds
        *
        *
        */
        autoAssign: function (options) {
            options = options || {};

            var opt = $.extend(true, {},
                serviceOptions,
                options,
                { url: urlConfig.getAPIPath(assignmentEndpoint) }
            );

            var params = {
                account: opt.account,
                project: opt.project,
                group: opt.group
            };

            if (opt.maxUsers) {
                params.maxUsers = opt.maxUsers;
        }

            return http.post(params, opt);
        },

        /**
        * Get the project's multiuser configuration
        *
        *
        */
        getProjectSettings: function (options) {
            options = options || {};

            var opt = $.extend(true, {},
                serviceOptions,
                options,
                { url: urlConfig.getAPIPath(projectEndpoint) }
            );

            opt.url += [opt.account, opt.project].join('/');

            return http.get(null, opt);
        }

    };

    $.extend(this, publicAPI);
};

},{"../store/store-factory":36,"../transport/http-transport-factory":38,"../util/object-util":41,"./configuration-service":26}],35:[function(require,module,exports){
/**
 * @class Cookie Storage Service
 *
 * @example
 *      var people = require('cookie-store')({ root: 'people' });
        people
            .save({lastName: 'smith' })

 */


'use strict';

module.exports = function (config) {
    var defaults = {
        /**
         * Name of collection
         * @type { string}
         */
        root: '/',

        domain: '.forio.com'
    };
    var serviceOptions = $.extend({}, defaults, config);

    var publicAPI = {
        // * TBD
        //  * Query collection; uses MongoDB syntax
        //  * @see  <TBD: Data API URL>
        //  *
        //  * @param { string} qs Query Filter
        //  * @param { string} limiters @see <TBD: url for limits, paging etc>
        //  *
        //  * @example
        //  *     cs.query(
        //  *      { name: 'John', className: 'CSC101' },
        //  *      {limit: 10}
        //  *     )

        // query: function (qs, limiters) {

        // },

        /**
         * Save cookie value
         * @param  { string|Object} key   If given a key save values under it, if given an object directly, save to top-level api
         * @param  {Object} value (Optional)
         * @param {Object} options Overrides for service options
         *
         * @return {*} The saved value
         *
         * @example
         *     cs.set('person', { firstName: 'john', lastName: 'smith' });
         *     cs.set({ name:'smith', age:'32' });
         */
        set: function (key, value, options) {
            var setOptions = $.extend(true, {}, serviceOptions, options);

            var domain = setOptions.domain;
            var path = setOptions.root;

            document.cookie = encodeURIComponent(key) + '=' +
                                encodeURIComponent(value) +
                                (domain ? '; domain=' + domain : '') +
                                (path ? '; path=' + path : '');

            return value;
        },

        /**
         * Load cookie value
         * @param  { string|Object} key   If given a key save values under it, if given an object directly, save to top-level api
         * @return {*} The value stored
         *
         * @example
         *     cs.get('person');
         */
        get: function (key) {
            var cookieReg = new RegExp('(?:(?:^|.*;)\\s*' + encodeURIComponent(key).replace(/[\-\.\+\*]/g, '\\$&') + '\\s*\\=\\s*([^;]*).*$)|^.*$');
            var val = document.cookie.replace(cookieReg, '$1');
            val = decodeURIComponent(val) || null;
            return val;
        },

        /**
         * Removes key from collection
         * @param { string} key key to remove
         * @return { string} key The key removed
         *
         * @example
         *     cs.remove('person');
         */
        remove: function (key, options) {
            var remOptions = $.extend(true, {}, serviceOptions, options);

            var domain = remOptions.domain;
            var path = remOptions.root;

            document.cookie = encodeURIComponent(key) +
                            '=; expires=Thu, 01 Jan 1970 00:00:00 GMT' +
                            (domain ? '; domain=' + domain : '') +
                            (path ? '; path=' + path : '');
            return key;
        },

        /**
         * Removes collection being referenced
         * @return { array} keys All the keys removed
         */
        destroy: function () {
            var aKeys = document.cookie.replace(/((?:^|\s*;)[^\=]+)(?=;|$)|^\s*|\s*(?:\=[^;]*)?(?:\1|$)/g, '').split(/\s*(?:\=[^;]*)?;\s*/);
            for (var nIdx = 0; nIdx < aKeys.length; nIdx++) {
                var cookieKey = decodeURIComponent(aKeys[nIdx]);
                this.remove(cookieKey);
            }
            return aKeys;
        }
    };

    $.extend(this, publicAPI);
};

},{}],36:[function(require,module,exports){
/**
    Decides type of store to provide
*/

'use strict';
// var isNode = false; FIXME: Browserify/minifyify has issues with the next link
// var store = (isNode) ? require('./session-store') : require('./cookie-store');
var store = require('./cookie-store');

module.exports = store;

},{"./cookie-store":35}],37:[function(require,module,exports){
'use strict';

var qutils = require('../util/query-util');

module.exports = function (config) {

    var defaults = {
        url: '',

        contentType: 'application/json',
        headers: {},
        statusCode: {
            404: $.noop
        },

        /**
         * ONLY for strings in the url. All GET & DELETE params are run through this
         * @type {[type] }
         */
        parameterParser: qutils.toQueryFormat,

        // To allow epicenter.token and other session cookies to be passed
        // with the requests
        xhrFields: {
            withCredentials: true
        }
    };

    var transportOptions = $.extend({}, defaults, config);

    var result = function (d) {
        return ($.isFunction(d)) ? d() : d;
    };

    var connect = function (method, params, connectOptions) {
        params = result(params);
        params = ($.isPlainObject(params) || $.isArray(params)) ? JSON.stringify(params) : params;

        var options = $.extend(true, {}, transportOptions, connectOptions, {
            type: method,
            data: params
        });
        var ALLOWED_TO_BE_FUNCTIONS = ['data', 'url'];
        $.each(options, function (key, value) {
            if ($.isFunction(value) && $.inArray(key, ALLOWED_TO_BE_FUNCTIONS) !== -1) {
                options[key] = value();
            }
        });

        if (options.logLevel && options.logLevel === 'DEBUG') {
            console.log(options.url);
            var oldSuccessFn = options.success || $.noop;
            options.success = function (response, ajaxStatus, ajaxReq) {
                console.log(response);
                oldSuccessFn.apply(this, arguments);
            };
        }

        var beforeSend = options.beforeSend;
        options.beforeSend = function (xhr, settings) {
            xhr.requestUrl = (connectOptions || {}).url;
            if (beforeSend) {
                beforeSend.apply(this, arguments);
            }
        };

        return $.ajax(options);
    };

    var publicAPI = {
        get:function (params, ajaxOptions) {
            var options = $.extend({}, transportOptions, ajaxOptions);
            params = options.parameterParser(result(params));
            return connect.call(this, 'GET', params, options);
        },
        post: function () {
            return connect.apply(this, ['post'].concat([].slice.call(arguments)));
        },
        patch: function () {
            return connect.apply(this, ['patch'].concat([].slice.call(arguments)));
        },
        put: function () {
            return connect.apply(this, ['put'].concat([].slice.call(arguments)));
        },
        delete: function (params, ajaxOptions) {
            //DELETE doesn't support body params, but jQuery thinks it does.
            var options = $.extend({}, transportOptions, ajaxOptions);
            params = options.parameterParser(result(params));
            if ($.trim(params)) {
                var delimiter = (result(options.url).indexOf('?') === -1) ? '?' : '&';
                options.url = result(options.url) + delimiter + params;
            }
            return connect.call(this, 'DELETE', null, options);
        },
        head: function () {
            return connect.apply(this, ['head'].concat([].slice.call(arguments)));
        },
        options: function () {
            return connect.apply(this, ['options'].concat([].slice.call(arguments)));
        }
    };

    return $.extend(this, publicAPI);
};

},{"../util/query-util":42}],38:[function(require,module,exports){
'use strict';

// var isNode = false; FIXME: Browserify/minifyify has issues with the next link
// var transport = (isNode) ? require('./node-http-transport') : require('./ajax-http-transport');
var transport = require('./ajax-http-transport');
module.exports = transport;

},{"./ajax-http-transport":37}],39:[function(require,module,exports){
/**
/* Inherit from a class (using prototype borrowing)
*/
'use strict';

function inherit(C, P) {
    var F = function () {};
    F.prototype = P.prototype;
    C.prototype = new F();
    C.__super = P.prototype;
    C.prototype.constructor = C;
}

/**
* Shallow copy of an object
*/
var extend = function (dest /*, var_args*/) {
    var obj = Array.prototype.slice.call(arguments, 1);
    var current;
    for (var j = 0; j<obj.length; j++) {
        if (!(current = obj[j])) {
            continue;
        }

        // do not wrap inner in dest.hasOwnProperty or bad things will happen
        /*jshint -W089 */
        for (var key in current) {
            dest[key] = current[key];
        }
    }

    return dest;
};

module.exports = function (base, props, staticProps) {
    var parent = base;
    var child;

    child = props && props.hasOwnProperty('constructor') ? props.constructor : function () { return parent.apply(this, arguments); };

    // add static properties to the child constructor function
    extend(child, parent, staticProps);

    // associate prototype chain
    inherit(child, parent);

    // add instance properties
    if (props) {
        extend(child.prototype, props);
    }

    // done
    return child;
};

},{}],40:[function(require,module,exports){
'use strict';
/*jshint loopfunc:false */

function _w(val) {
    if (val && val.then) {
        return val;
    }
    var p = $.Deferred();
    p.resolve(val);

    return p.promise();
}

function seq() {
    var list = Array.prototype.slice.apply(arguments);

    function next(p) {
        var cur = list.splice(0,1)[0];

        if (!cur) {
            return p;
        }

        return _w(cur(p)).then(next);
    }

    return function (seed) {
        return next(seed).fail(seq.fail);
    };
}

function MakeSeq(obj) {
    var res = {
        __calls: [],

        original: obj,

        then: function (fn) {
            this.__calls.push(fn);
            return this;
        },

        start: function () {
            var _this = this;

            // clean up
            this.then(function (run) {
                _this.__calls.length = 0;
                return run;
            });

            return seq.apply(null, this.__calls)();
        },

        fail: function (fn) {
            seq.fail = fn;
            return this;
        }
    };

    var funcMaker = function (p, obj) {
        var fn = obj[p].bind(obj);
        return function () {
            var args = Array.prototype.slice.apply(arguments);
            this.__calls.push(Function.bind.apply(fn, [null].concat(args)));
            return this;
        };
    };

    for (var prop in obj) {
        if (typeof obj[prop] === 'function') {
            res[prop] = funcMaker(prop, obj);
        } else {
            res[prop] = obj[prop];
        }
    }

    return res;
}

module.exports = MakeSeq;

},{}],41:[function(require,module,exports){
'use strict';

module.exports = {
    _pick: function (obj, props) {
        var res = {};
        for (var p in obj) {
            if (props.indexOf(p) !== -1) {
                res[p] = obj[p];
            }
        }

        return res;
    }
};

},{}],42:[function(require,module,exports){
/**
 * Utilities for working with query strings
*/
'use strict';

module.exports = (function () {

    return {
        /**
         * Converts to matrix format
         * @param  {Object} qs Object to convert to query string
         * @return { string}    Matrix-format query parameters
         */
        toMatrixFormat: function (qs) {
            if (qs === null || qs === undefined || qs === '') {
                return ';';
            }
            if (typeof qs === 'string' || qs instanceof String) {
                return qs;
            }

            var returnArray = [];
            var OPERATORS = ['<', '>', '!'];
            $.each(qs, function (key, value) {
                if (typeof value !== 'string' || $.inArray($.trim(value).charAt(0), OPERATORS) === -1) {
                    value = '=' + value;
                }
                returnArray.push(key + value);
            });

            var mtrx = ';' + returnArray.join(';');
            return mtrx;
        },

        /**
         * Converts strings/arrays/objects to type 'a=b&b=c'
         * @param  { string|Array|Object} qs
         * @return { string}
         */
        toQueryFormat: function (qs) {
            if (qs === null || qs === undefined) {
                return '';
            }
            if (typeof qs === 'string' || qs instanceof String) {
                return qs;
            }

            var returnArray = [];
            $.each(qs, function (key, value) {
                if ($.isArray(value)) {
                    value = value.join(',');
                }
                if ($.isPlainObject(value)) {
                    //Mostly for data api
                    value = JSON.stringify(value);
                }
                returnArray.push(key + '=' + value);
            });

            var result = returnArray.join('&');
            return result;
        },

        /**
         * Converts strings of type 'a=b&b=c' to { a:b, b:c}
         * @param  { string} qs
         * @return {object}
         */
        qsToObject: function (qs) {
            if (qs === null || qs === undefined || qs === '') {
                return {};
            }

            var qsArray = qs.split('&');
            var returnObj = {};
            $.each(qsArray, function (index, value) {
                var qKey = value.split('=')[0];
                var qVal = value.split('=')[1];

                if (qVal.indexOf(',') !== -1) {
                    qVal = qVal.split(',');
                }

                returnObj[qKey] = qVal;
            });

            return returnObj;
        },

        /**
         * Normalizes and merges strings of type 'a=b', { b:c} to { a:b, b:c}
         * @param  { string|Array|Object} qs1
         * @param  { string|Array|Object} qs2
         * @return {Object}
         */
        mergeQS: function (qs1, qs2) {
            var obj1 = this.qsToObject(this.toQueryFormat(qs1));
            var obj2 = this.qsToObject(this.toQueryFormat(qs2));
            return $.extend(true, {}, obj1, obj2);
        },

        addTrailingSlash: function (url) {
            if (!url) {
                return '';
            }
            return (url.charAt(url.length - 1) === '/') ? url : (url + '/');
        }
    };
}());




},{}],43:[function(require,module,exports){
/**
 * Utilities for working with the run service
*/
'use strict';

module.exports = (function () {
    return {
        /**
         * returns operations of the form [[op1,op2], [arg1, arg2]]
         * @param  {Object|Array|String} operations operations to perform
         * @param  { array} arugments for operation
         * @return { string}    Matrix-format query parameters
         */
        normalizeOperations: function (operations, args) {
            if (!args) {
                args = [];
            }
            var returnList = {
                ops: [],
                args: []
            };

            var _concat = function (arr) {
                return (arr !== null && arr !== undefined) ? [].concat(arr) : [];
            };

            //{ add: [1,2], subtract: [2,4] }
            var _normalizePlainObjects = function (operations, returnList) {
                if (!returnList) {
                    returnList = { ops: [], args: [] };
                }
                $.each(operations, function (opn, arg) {
                    returnList.ops.push(opn);
                    returnList.args.push(_concat(arg));
                });
                return returnList;
            };
            //{ name: 'add', params: [1] }
            var _normalizeStructuredObjects = function (operation, returnList) {
                if (!returnList) {
                    returnList = { ops: [], args: [] };
                }
                returnList.ops.push(operation.name);
                returnList.args.push(_concat(operation.params));
                return returnList;
            };

            var _normalizeObject = function (operation, returnList) {
                return ((operation.name) ? _normalizeStructuredObjects : _normalizePlainObjects)(operation, returnList);
            };

            var _normalizeLiterals = function (operation, args, returnList) {
                if (!returnList) {
                    returnList = { ops: [], args: [] };
                }
                returnList.ops.push(operation);
                returnList.args.push(_concat(args));
                return returnList;
            };


            var _normalizeArrays = function (operations, arg, returnList) {
                if (!returnList) {
                    returnList = { ops: [], args: [] };
                }
                $.each(operations, function (index, opn) {
                    if ($.isPlainObject(opn)) {
                        _normalizeObject(opn, returnList);
                    } else {
                        _normalizeLiterals(opn, args[index], returnList);
                    }
                });
                return returnList;
            };

            if ($.isPlainObject(operations)) {
                _normalizeObject(operations, returnList);
            } else if ($.isArray(operations)) {
                _normalizeArrays(operations, args, returnList);
            } else {
                _normalizeLiterals(operations, args, returnList);
            }

            return returnList;
        }
    };
}());

},{}]},{},[5])
//# sourceMappingURL=data:application/json;charset:utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIm5vZGVfbW9kdWxlcy9ncnVudC1icm93c2VyaWZ5L25vZGVfbW9kdWxlcy9icm93c2VyaWZ5L25vZGVfbW9kdWxlcy9icm93c2VyLXBhY2svX3ByZWx1ZGUuanMiLCJub2RlX21vZHVsZXMvZ3J1bnQtYnJvd3NlcmlmeS9ub2RlX21vZHVsZXMvYnJvd3NlcmlmeS9ub2RlX21vZHVsZXMvYnVmZmVyL2luZGV4LmpzIiwibm9kZV9tb2R1bGVzL2dydW50LWJyb3dzZXJpZnkvbm9kZV9tb2R1bGVzL2Jyb3dzZXJpZnkvbm9kZV9tb2R1bGVzL2J1ZmZlci9ub2RlX21vZHVsZXMvYmFzZTY0LWpzL2xpYi9iNjQuanMiLCJub2RlX21vZHVsZXMvZ3J1bnQtYnJvd3NlcmlmeS9ub2RlX21vZHVsZXMvYnJvd3NlcmlmeS9ub2RlX21vZHVsZXMvYnVmZmVyL25vZGVfbW9kdWxlcy9pZWVlNzU0L2luZGV4LmpzIiwibm9kZV9tb2R1bGVzL2dydW50LWJyb3dzZXJpZnkvbm9kZV9tb2R1bGVzL2Jyb3dzZXJpZnkvbm9kZV9tb2R1bGVzL2J1ZmZlci9ub2RlX21vZHVsZXMvaXMtYXJyYXkvaW5kZXguanMiLCJzcmMvYXBwLmpzIiwic3JjL21hbmFnZXJzL2F1dGgtbWFuYWdlci5qcyIsInNyYy9tYW5hZ2Vycy9jaGFubmVsLW1hbmFnZXIuanMiLCJzcmMvbWFuYWdlcnMvZXBpY2VudGVyLWNoYW5uZWwtbWFuYWdlci5qcyIsInNyYy9tYW5hZ2Vycy9rZXktbmFtZXMuanMiLCJzcmMvbWFuYWdlcnMvcnVuLW1hbmFnZXIuanMiLCJzcmMvbWFuYWdlcnMvcnVuLXN0cmF0ZWdpZXMvYWx3YXlzLW5ldy1zdHJhdGVneS5qcyIsInNyYy9tYW5hZ2Vycy9ydW4tc3RyYXRlZ2llcy9iYXNlLWlmLWluaXRpYWxpemVkLXN0cmF0ZWd5LmpzIiwic3JjL21hbmFnZXJzL3J1bi1zdHJhdGVnaWVzL2NvbmRpdGlvbmFsLWNyZWF0aW9uLXN0cmF0ZWd5LmpzIiwic3JjL21hbmFnZXJzL3J1bi1zdHJhdGVnaWVzL2lkZW50aXR5LXN0cmF0ZWd5LmpzIiwic3JjL21hbmFnZXJzL3J1bi1zdHJhdGVnaWVzL211bHRpcGxheWVyLXN0cmF0ZWd5LmpzIiwic3JjL21hbmFnZXJzL3J1bi1zdHJhdGVnaWVzL25ldy1pZi1pbml0aWFsaXplZC1zdHJhdGVneS5qcyIsInNyYy9tYW5hZ2Vycy9ydW4tc3RyYXRlZ2llcy9uZXctaWYtbWlzc2luZy1zdHJhdGVneS5qcyIsInNyYy9tYW5hZ2Vycy9ydW4tc3RyYXRlZ2llcy9uZXctaWYtcGVyc2lzdGVkLXN0cmF0ZWd5LmpzIiwic3JjL21hbmFnZXJzL3J1bi1zdHJhdGVnaWVzL3BlcnNpc3RlbnQtc2luZ2xlLXBsYXllci1zdHJhdGVneS5qcyIsInNyYy9tYW5hZ2Vycy9ydW4tc3RyYXRlZ2llcy9zdHJhdGVnaWVzLW1hcC5qcyIsInNyYy9tYW5hZ2Vycy9zY2VuYXJpby1tYW5hZ2VyLmpzIiwic3JjL21hbmFnZXJzL3NwZWNpYWwtb3BlcmF0aW9ucy5qcyIsInNyYy9tYW5hZ2Vycy93b3JsZC1tYW5hZ2VyLmpzIiwic3JjL3NlcnZpY2UvYXV0aC1hcGktc2VydmljZS5qcyIsInNyYy9zZXJ2aWNlL2NoYW5uZWwtc2VydmljZS5qcyIsInNyYy9zZXJ2aWNlL2NvbmZpZ3VyYXRpb24tc2VydmljZS5qcyIsInNyYy9zZXJ2aWNlL2RhdGEtYXBpLXNlcnZpY2UuanMiLCJzcmMvc2VydmljZS9tZW1iZXItYXBpLWFkYXB0ZXIuanMiLCJzcmMvc2VydmljZS9ydW4tYXBpLXNlcnZpY2UuanMiLCJzcmMvc2VydmljZS9zdGF0ZS1hcGktYWRhcHRlci5qcyIsInNyYy9zZXJ2aWNlL3VybC1jb25maWctc2VydmljZS5qcyIsInNyYy9zZXJ2aWNlL3VzZXItYXBpLWFkYXB0ZXIuanMiLCJzcmMvc2VydmljZS92YXJpYWJsZXMtYXBpLXNlcnZpY2UuanMiLCJzcmMvc2VydmljZS93b3JsZC1hcGktYWRhcHRlci5qcyIsInNyYy9zdG9yZS9jb29raWUtc3RvcmUuanMiLCJzcmMvc3RvcmUvc3RvcmUtZmFjdG9yeS5qcyIsInNyYy90cmFuc3BvcnQvYWpheC1odHRwLXRyYW5zcG9ydC5qcyIsInNyYy90cmFuc3BvcnQvaHR0cC10cmFuc3BvcnQtZmFjdG9yeS5qcyIsInNyYy91dGlsL2luaGVyaXQuanMiLCJzcmMvdXRpbC9tYWtlLXNlcXVlbmNlLmpzIiwic3JjL3V0aWwvb2JqZWN0LXV0aWwuanMiLCJzcmMvdXRpbC9xdWVyeS11dGlsLmpzIiwic3JjL3V0aWwvcnVuLXV0aWwuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUE7QUNBQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDaC9DQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzVIQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNwRkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDakNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUMzREE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzdXQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDdk5BO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDbExBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ05BO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3pKQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ25CQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDdkhBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUN4R0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDckJBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDL0VBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNqQkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3ZCQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDakJBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzFGQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ1ZBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDakRBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNSQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUMzS0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDM0hBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDeExBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3hFQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ2pQQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDOUdBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDamJBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ2pGQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDOURBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ2hHQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3BKQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNyb0JBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDekhBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDVkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3hHQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNOQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUN0REE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDakZBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNkQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ2hIQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQSIsImZpbGUiOiJnZW5lcmF0ZWQuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlc0NvbnRlbnQiOlsiKGZ1bmN0aW9uIGUodCxuLHIpe2Z1bmN0aW9uIHMobyx1KXtpZighbltvXSl7aWYoIXRbb10pe3ZhciBhPXR5cGVvZiByZXF1aXJlPT1cImZ1bmN0aW9uXCImJnJlcXVpcmU7aWYoIXUmJmEpcmV0dXJuIGEobywhMCk7aWYoaSlyZXR1cm4gaShvLCEwKTt2YXIgZj1uZXcgRXJyb3IoXCJDYW5ub3QgZmluZCBtb2R1bGUgJ1wiK28rXCInXCIpO3Rocm93IGYuY29kZT1cIk1PRFVMRV9OT1RfRk9VTkRcIixmfXZhciBsPW5bb109e2V4cG9ydHM6e319O3Rbb11bMF0uY2FsbChsLmV4cG9ydHMsZnVuY3Rpb24oZSl7dmFyIG49dFtvXVsxXVtlXTtyZXR1cm4gcyhuP246ZSl9LGwsbC5leHBvcnRzLGUsdCxuLHIpfXJldHVybiBuW29dLmV4cG9ydHN9dmFyIGk9dHlwZW9mIHJlcXVpcmU9PVwiZnVuY3Rpb25cIiYmcmVxdWlyZTtmb3IodmFyIG89MDtvPHIubGVuZ3RoO28rKylzKHJbb10pO3JldHVybiBzfSkiLCIvKiFcbiAqIFRoZSBidWZmZXIgbW9kdWxlIGZyb20gbm9kZS5qcywgZm9yIHRoZSBicm93c2VyLlxuICpcbiAqIEBhdXRob3IgICBGZXJvc3MgQWJvdWtoYWRpamVoIDxmZXJvc3NAZmVyb3NzLm9yZz4gPGh0dHA6Ly9mZXJvc3Mub3JnPlxuICogQGxpY2Vuc2UgIE1JVFxuICovXG5cbnZhciBiYXNlNjQgPSByZXF1aXJlKCdiYXNlNjQtanMnKVxudmFyIGllZWU3NTQgPSByZXF1aXJlKCdpZWVlNzU0JylcbnZhciBpc0FycmF5ID0gcmVxdWlyZSgnaXMtYXJyYXknKVxuXG5leHBvcnRzLkJ1ZmZlciA9IEJ1ZmZlclxuZXhwb3J0cy5TbG93QnVmZmVyID0gU2xvd0J1ZmZlclxuZXhwb3J0cy5JTlNQRUNUX01BWF9CWVRFUyA9IDUwXG5CdWZmZXIucG9vbFNpemUgPSA4MTkyIC8vIG5vdCB1c2VkIGJ5IHRoaXMgaW1wbGVtZW50YXRpb25cblxudmFyIHJvb3RQYXJlbnQgPSB7fVxuXG4vKipcbiAqIElmIGBCdWZmZXIuVFlQRURfQVJSQVlfU1VQUE9SVGA6XG4gKiAgID09PSB0cnVlICAgIFVzZSBVaW50OEFycmF5IGltcGxlbWVudGF0aW9uIChmYXN0ZXN0KVxuICogICA9PT0gZmFsc2UgICBVc2UgT2JqZWN0IGltcGxlbWVudGF0aW9uIChtb3N0IGNvbXBhdGlibGUsIGV2ZW4gSUU2KVxuICpcbiAqIEJyb3dzZXJzIHRoYXQgc3VwcG9ydCB0eXBlZCBhcnJheXMgYXJlIElFIDEwKywgRmlyZWZveCA0KywgQ2hyb21lIDcrLCBTYWZhcmkgNS4xKyxcbiAqIE9wZXJhIDExLjYrLCBpT1MgNC4yKy5cbiAqXG4gKiBEdWUgdG8gdmFyaW91cyBicm93c2VyIGJ1Z3MsIHNvbWV0aW1lcyB0aGUgT2JqZWN0IGltcGxlbWVudGF0aW9uIHdpbGwgYmUgdXNlZCBldmVuXG4gKiB3aGVuIHRoZSBicm93c2VyIHN1cHBvcnRzIHR5cGVkIGFycmF5cy5cbiAqXG4gKiBOb3RlOlxuICpcbiAqICAgLSBGaXJlZm94IDQtMjkgbGFja3Mgc3VwcG9ydCBmb3IgYWRkaW5nIG5ldyBwcm9wZXJ0aWVzIHRvIGBVaW50OEFycmF5YCBpbnN0YW5jZXMsXG4gKiAgICAgU2VlOiBodHRwczovL2J1Z3ppbGxhLm1vemlsbGEub3JnL3Nob3dfYnVnLmNnaT9pZD02OTU0MzguXG4gKlxuICogICAtIFNhZmFyaSA1LTcgbGFja3Mgc3VwcG9ydCBmb3IgY2hhbmdpbmcgdGhlIGBPYmplY3QucHJvdG90eXBlLmNvbnN0cnVjdG9yYCBwcm9wZXJ0eVxuICogICAgIG9uIG9iamVjdHMuXG4gKlxuICogICAtIENocm9tZSA5LTEwIGlzIG1pc3NpbmcgdGhlIGBUeXBlZEFycmF5LnByb3RvdHlwZS5zdWJhcnJheWAgZnVuY3Rpb24uXG4gKlxuICogICAtIElFMTAgaGFzIGEgYnJva2VuIGBUeXBlZEFycmF5LnByb3RvdHlwZS5zdWJhcnJheWAgZnVuY3Rpb24gd2hpY2ggcmV0dXJucyBhcnJheXMgb2ZcbiAqICAgICBpbmNvcnJlY3QgbGVuZ3RoIGluIHNvbWUgc2l0dWF0aW9ucy5cblxuICogV2UgZGV0ZWN0IHRoZXNlIGJ1Z2d5IGJyb3dzZXJzIGFuZCBzZXQgYEJ1ZmZlci5UWVBFRF9BUlJBWV9TVVBQT1JUYCB0byBgZmFsc2VgIHNvIHRoZXlcbiAqIGdldCB0aGUgT2JqZWN0IGltcGxlbWVudGF0aW9uLCB3aGljaCBpcyBzbG93ZXIgYnV0IGJlaGF2ZXMgY29ycmVjdGx5LlxuICovXG5CdWZmZXIuVFlQRURfQVJSQVlfU1VQUE9SVCA9IChmdW5jdGlvbiAoKSB7XG4gIGZ1bmN0aW9uIEJhciAoKSB7fVxuICB0cnkge1xuICAgIHZhciBhcnIgPSBuZXcgVWludDhBcnJheSgxKVxuICAgIGFyci5mb28gPSBmdW5jdGlvbiAoKSB7IHJldHVybiA0MiB9XG4gICAgYXJyLmNvbnN0cnVjdG9yID0gQmFyXG4gICAgcmV0dXJuIGFyci5mb28oKSA9PT0gNDIgJiYgLy8gdHlwZWQgYXJyYXkgaW5zdGFuY2VzIGNhbiBiZSBhdWdtZW50ZWRcbiAgICAgICAgYXJyLmNvbnN0cnVjdG9yID09PSBCYXIgJiYgLy8gY29uc3RydWN0b3IgY2FuIGJlIHNldFxuICAgICAgICB0eXBlb2YgYXJyLnN1YmFycmF5ID09PSAnZnVuY3Rpb24nICYmIC8vIGNocm9tZSA5LTEwIGxhY2sgYHN1YmFycmF5YFxuICAgICAgICBhcnIuc3ViYXJyYXkoMSwgMSkuYnl0ZUxlbmd0aCA9PT0gMCAvLyBpZTEwIGhhcyBicm9rZW4gYHN1YmFycmF5YFxuICB9IGNhdGNoIChlKSB7XG4gICAgcmV0dXJuIGZhbHNlXG4gIH1cbn0pKClcblxuZnVuY3Rpb24ga01heExlbmd0aCAoKSB7XG4gIHJldHVybiBCdWZmZXIuVFlQRURfQVJSQVlfU1VQUE9SVFxuICAgID8gMHg3ZmZmZmZmZlxuICAgIDogMHgzZmZmZmZmZlxufVxuXG4vKipcbiAqIENsYXNzOiBCdWZmZXJcbiAqID09PT09PT09PT09PT1cbiAqXG4gKiBUaGUgQnVmZmVyIGNvbnN0cnVjdG9yIHJldHVybnMgaW5zdGFuY2VzIG9mIGBVaW50OEFycmF5YCB0aGF0IGFyZSBhdWdtZW50ZWRcbiAqIHdpdGggZnVuY3Rpb24gcHJvcGVydGllcyBmb3IgYWxsIHRoZSBub2RlIGBCdWZmZXJgIEFQSSBmdW5jdGlvbnMuIFdlIHVzZVxuICogYFVpbnQ4QXJyYXlgIHNvIHRoYXQgc3F1YXJlIGJyYWNrZXQgbm90YXRpb24gd29ya3MgYXMgZXhwZWN0ZWQgLS0gaXQgcmV0dXJuc1xuICogYSBzaW5nbGUgb2N0ZXQuXG4gKlxuICogQnkgYXVnbWVudGluZyB0aGUgaW5zdGFuY2VzLCB3ZSBjYW4gYXZvaWQgbW9kaWZ5aW5nIHRoZSBgVWludDhBcnJheWBcbiAqIHByb3RvdHlwZS5cbiAqL1xuZnVuY3Rpb24gQnVmZmVyIChhcmcpIHtcbiAgaWYgKCEodGhpcyBpbnN0YW5jZW9mIEJ1ZmZlcikpIHtcbiAgICAvLyBBdm9pZCBnb2luZyB0aHJvdWdoIGFuIEFyZ3VtZW50c0FkYXB0b3JUcmFtcG9saW5lIGluIHRoZSBjb21tb24gY2FzZS5cbiAgICBpZiAoYXJndW1lbnRzLmxlbmd0aCA+IDEpIHJldHVybiBuZXcgQnVmZmVyKGFyZywgYXJndW1lbnRzWzFdKVxuICAgIHJldHVybiBuZXcgQnVmZmVyKGFyZylcbiAgfVxuXG4gIHRoaXMubGVuZ3RoID0gMFxuICB0aGlzLnBhcmVudCA9IHVuZGVmaW5lZFxuXG4gIC8vIENvbW1vbiBjYXNlLlxuICBpZiAodHlwZW9mIGFyZyA9PT0gJ251bWJlcicpIHtcbiAgICByZXR1cm4gZnJvbU51bWJlcih0aGlzLCBhcmcpXG4gIH1cblxuICAvLyBTbGlnaHRseSBsZXNzIGNvbW1vbiBjYXNlLlxuICBpZiAodHlwZW9mIGFyZyA9PT0gJ3N0cmluZycpIHtcbiAgICByZXR1cm4gZnJvbVN0cmluZyh0aGlzLCBhcmcsIGFyZ3VtZW50cy5sZW5ndGggPiAxID8gYXJndW1lbnRzWzFdIDogJ3V0ZjgnKVxuICB9XG5cbiAgLy8gVW51c3VhbC5cbiAgcmV0dXJuIGZyb21PYmplY3QodGhpcywgYXJnKVxufVxuXG5mdW5jdGlvbiBmcm9tTnVtYmVyICh0aGF0LCBsZW5ndGgpIHtcbiAgdGhhdCA9IGFsbG9jYXRlKHRoYXQsIGxlbmd0aCA8IDAgPyAwIDogY2hlY2tlZChsZW5ndGgpIHwgMClcbiAgaWYgKCFCdWZmZXIuVFlQRURfQVJSQVlfU1VQUE9SVCkge1xuICAgIGZvciAodmFyIGkgPSAwOyBpIDwgbGVuZ3RoOyBpKyspIHtcbiAgICAgIHRoYXRbaV0gPSAwXG4gICAgfVxuICB9XG4gIHJldHVybiB0aGF0XG59XG5cbmZ1bmN0aW9uIGZyb21TdHJpbmcgKHRoYXQsIHN0cmluZywgZW5jb2RpbmcpIHtcbiAgaWYgKHR5cGVvZiBlbmNvZGluZyAhPT0gJ3N0cmluZycgfHwgZW5jb2RpbmcgPT09ICcnKSBlbmNvZGluZyA9ICd1dGY4J1xuXG4gIC8vIEFzc3VtcHRpb246IGJ5dGVMZW5ndGgoKSByZXR1cm4gdmFsdWUgaXMgYWx3YXlzIDwga01heExlbmd0aC5cbiAgdmFyIGxlbmd0aCA9IGJ5dGVMZW5ndGgoc3RyaW5nLCBlbmNvZGluZykgfCAwXG4gIHRoYXQgPSBhbGxvY2F0ZSh0aGF0LCBsZW5ndGgpXG5cbiAgdGhhdC53cml0ZShzdHJpbmcsIGVuY29kaW5nKVxuICByZXR1cm4gdGhhdFxufVxuXG5mdW5jdGlvbiBmcm9tT2JqZWN0ICh0aGF0LCBvYmplY3QpIHtcbiAgaWYgKEJ1ZmZlci5pc0J1ZmZlcihvYmplY3QpKSByZXR1cm4gZnJvbUJ1ZmZlcih0aGF0LCBvYmplY3QpXG5cbiAgaWYgKGlzQXJyYXkob2JqZWN0KSkgcmV0dXJuIGZyb21BcnJheSh0aGF0LCBvYmplY3QpXG5cbiAgaWYgKG9iamVjdCA9PSBudWxsKSB7XG4gICAgdGhyb3cgbmV3IFR5cGVFcnJvcignbXVzdCBzdGFydCB3aXRoIG51bWJlciwgYnVmZmVyLCBhcnJheSBvciBzdHJpbmcnKVxuICB9XG5cbiAgaWYgKHR5cGVvZiBBcnJheUJ1ZmZlciAhPT0gJ3VuZGVmaW5lZCcpIHtcbiAgICBpZiAob2JqZWN0LmJ1ZmZlciBpbnN0YW5jZW9mIEFycmF5QnVmZmVyKSB7XG4gICAgICByZXR1cm4gZnJvbVR5cGVkQXJyYXkodGhhdCwgb2JqZWN0KVxuICAgIH1cbiAgICBpZiAob2JqZWN0IGluc3RhbmNlb2YgQXJyYXlCdWZmZXIpIHtcbiAgICAgIHJldHVybiBmcm9tQXJyYXlCdWZmZXIodGhhdCwgb2JqZWN0KVxuICAgIH1cbiAgfVxuXG4gIGlmIChvYmplY3QubGVuZ3RoKSByZXR1cm4gZnJvbUFycmF5TGlrZSh0aGF0LCBvYmplY3QpXG5cbiAgcmV0dXJuIGZyb21Kc29uT2JqZWN0KHRoYXQsIG9iamVjdClcbn1cblxuZnVuY3Rpb24gZnJvbUJ1ZmZlciAodGhhdCwgYnVmZmVyKSB7XG4gIHZhciBsZW5ndGggPSBjaGVja2VkKGJ1ZmZlci5sZW5ndGgpIHwgMFxuICB0aGF0ID0gYWxsb2NhdGUodGhhdCwgbGVuZ3RoKVxuICBidWZmZXIuY29weSh0aGF0LCAwLCAwLCBsZW5ndGgpXG4gIHJldHVybiB0aGF0XG59XG5cbmZ1bmN0aW9uIGZyb21BcnJheSAodGhhdCwgYXJyYXkpIHtcbiAgdmFyIGxlbmd0aCA9IGNoZWNrZWQoYXJyYXkubGVuZ3RoKSB8IDBcbiAgdGhhdCA9IGFsbG9jYXRlKHRoYXQsIGxlbmd0aClcbiAgZm9yICh2YXIgaSA9IDA7IGkgPCBsZW5ndGg7IGkgKz0gMSkge1xuICAgIHRoYXRbaV0gPSBhcnJheVtpXSAmIDI1NVxuICB9XG4gIHJldHVybiB0aGF0XG59XG5cbi8vIER1cGxpY2F0ZSBvZiBmcm9tQXJyYXkoKSB0byBrZWVwIGZyb21BcnJheSgpIG1vbm9tb3JwaGljLlxuZnVuY3Rpb24gZnJvbVR5cGVkQXJyYXkgKHRoYXQsIGFycmF5KSB7XG4gIHZhciBsZW5ndGggPSBjaGVja2VkKGFycmF5Lmxlbmd0aCkgfCAwXG4gIHRoYXQgPSBhbGxvY2F0ZSh0aGF0LCBsZW5ndGgpXG4gIC8vIFRydW5jYXRpbmcgdGhlIGVsZW1lbnRzIGlzIHByb2JhYmx5IG5vdCB3aGF0IHBlb3BsZSBleHBlY3QgZnJvbSB0eXBlZFxuICAvLyBhcnJheXMgd2l0aCBCWVRFU19QRVJfRUxFTUVOVCA+IDEgYnV0IGl0J3MgY29tcGF0aWJsZSB3aXRoIHRoZSBiZWhhdmlvclxuICAvLyBvZiB0aGUgb2xkIEJ1ZmZlciBjb25zdHJ1Y3Rvci5cbiAgZm9yICh2YXIgaSA9IDA7IGkgPCBsZW5ndGg7IGkgKz0gMSkge1xuICAgIHRoYXRbaV0gPSBhcnJheVtpXSAmIDI1NVxuICB9XG4gIHJldHVybiB0aGF0XG59XG5cbmZ1bmN0aW9uIGZyb21BcnJheUJ1ZmZlciAodGhhdCwgYXJyYXkpIHtcbiAgaWYgKEJ1ZmZlci5UWVBFRF9BUlJBWV9TVVBQT1JUKSB7XG4gICAgLy8gUmV0dXJuIGFuIGF1Z21lbnRlZCBgVWludDhBcnJheWAgaW5zdGFuY2UsIGZvciBiZXN0IHBlcmZvcm1hbmNlXG4gICAgYXJyYXkuYnl0ZUxlbmd0aFxuICAgIHRoYXQgPSBCdWZmZXIuX2F1Z21lbnQobmV3IFVpbnQ4QXJyYXkoYXJyYXkpKVxuICB9IGVsc2Uge1xuICAgIC8vIEZhbGxiYWNrOiBSZXR1cm4gYW4gb2JqZWN0IGluc3RhbmNlIG9mIHRoZSBCdWZmZXIgY2xhc3NcbiAgICB0aGF0ID0gZnJvbVR5cGVkQXJyYXkodGhhdCwgbmV3IFVpbnQ4QXJyYXkoYXJyYXkpKVxuICB9XG4gIHJldHVybiB0aGF0XG59XG5cbmZ1bmN0aW9uIGZyb21BcnJheUxpa2UgKHRoYXQsIGFycmF5KSB7XG4gIHZhciBsZW5ndGggPSBjaGVja2VkKGFycmF5Lmxlbmd0aCkgfCAwXG4gIHRoYXQgPSBhbGxvY2F0ZSh0aGF0LCBsZW5ndGgpXG4gIGZvciAodmFyIGkgPSAwOyBpIDwgbGVuZ3RoOyBpICs9IDEpIHtcbiAgICB0aGF0W2ldID0gYXJyYXlbaV0gJiAyNTVcbiAgfVxuICByZXR1cm4gdGhhdFxufVxuXG4vLyBEZXNlcmlhbGl6ZSB7IHR5cGU6ICdCdWZmZXInLCBkYXRhOiBbMSwyLDMsLi4uXSB9IGludG8gYSBCdWZmZXIgb2JqZWN0LlxuLy8gUmV0dXJucyBhIHplcm8tbGVuZ3RoIGJ1ZmZlciBmb3IgaW5wdXRzIHRoYXQgZG9uJ3QgY29uZm9ybSB0byB0aGUgc3BlYy5cbmZ1bmN0aW9uIGZyb21Kc29uT2JqZWN0ICh0aGF0LCBvYmplY3QpIHtcbiAgdmFyIGFycmF5XG4gIHZhciBsZW5ndGggPSAwXG5cbiAgaWYgKG9iamVjdC50eXBlID09PSAnQnVmZmVyJyAmJiBpc0FycmF5KG9iamVjdC5kYXRhKSkge1xuICAgIGFycmF5ID0gb2JqZWN0LmRhdGFcbiAgICBsZW5ndGggPSBjaGVja2VkKGFycmF5Lmxlbmd0aCkgfCAwXG4gIH1cbiAgdGhhdCA9IGFsbG9jYXRlKHRoYXQsIGxlbmd0aClcblxuICBmb3IgKHZhciBpID0gMDsgaSA8IGxlbmd0aDsgaSArPSAxKSB7XG4gICAgdGhhdFtpXSA9IGFycmF5W2ldICYgMjU1XG4gIH1cbiAgcmV0dXJuIHRoYXRcbn1cblxuZnVuY3Rpb24gYWxsb2NhdGUgKHRoYXQsIGxlbmd0aCkge1xuICBpZiAoQnVmZmVyLlRZUEVEX0FSUkFZX1NVUFBPUlQpIHtcbiAgICAvLyBSZXR1cm4gYW4gYXVnbWVudGVkIGBVaW50OEFycmF5YCBpbnN0YW5jZSwgZm9yIGJlc3QgcGVyZm9ybWFuY2VcbiAgICB0aGF0ID0gQnVmZmVyLl9hdWdtZW50KG5ldyBVaW50OEFycmF5KGxlbmd0aCkpXG4gIH0gZWxzZSB7XG4gICAgLy8gRmFsbGJhY2s6IFJldHVybiBhbiBvYmplY3QgaW5zdGFuY2Ugb2YgdGhlIEJ1ZmZlciBjbGFzc1xuICAgIHRoYXQubGVuZ3RoID0gbGVuZ3RoXG4gICAgdGhhdC5faXNCdWZmZXIgPSB0cnVlXG4gIH1cblxuICB2YXIgZnJvbVBvb2wgPSBsZW5ndGggIT09IDAgJiYgbGVuZ3RoIDw9IEJ1ZmZlci5wb29sU2l6ZSA+Pj4gMVxuICBpZiAoZnJvbVBvb2wpIHRoYXQucGFyZW50ID0gcm9vdFBhcmVudFxuXG4gIHJldHVybiB0aGF0XG59XG5cbmZ1bmN0aW9uIGNoZWNrZWQgKGxlbmd0aCkge1xuICAvLyBOb3RlOiBjYW5ub3QgdXNlIGBsZW5ndGggPCBrTWF4TGVuZ3RoYCBoZXJlIGJlY2F1c2UgdGhhdCBmYWlscyB3aGVuXG4gIC8vIGxlbmd0aCBpcyBOYU4gKHdoaWNoIGlzIG90aGVyd2lzZSBjb2VyY2VkIHRvIHplcm8uKVxuICBpZiAobGVuZ3RoID49IGtNYXhMZW5ndGgoKSkge1xuICAgIHRocm93IG5ldyBSYW5nZUVycm9yKCdBdHRlbXB0IHRvIGFsbG9jYXRlIEJ1ZmZlciBsYXJnZXIgdGhhbiBtYXhpbXVtICcgK1xuICAgICAgICAgICAgICAgICAgICAgICAgICdzaXplOiAweCcgKyBrTWF4TGVuZ3RoKCkudG9TdHJpbmcoMTYpICsgJyBieXRlcycpXG4gIH1cbiAgcmV0dXJuIGxlbmd0aCB8IDBcbn1cblxuZnVuY3Rpb24gU2xvd0J1ZmZlciAoc3ViamVjdCwgZW5jb2RpbmcpIHtcbiAgaWYgKCEodGhpcyBpbnN0YW5jZW9mIFNsb3dCdWZmZXIpKSByZXR1cm4gbmV3IFNsb3dCdWZmZXIoc3ViamVjdCwgZW5jb2RpbmcpXG5cbiAgdmFyIGJ1ZiA9IG5ldyBCdWZmZXIoc3ViamVjdCwgZW5jb2RpbmcpXG4gIGRlbGV0ZSBidWYucGFyZW50XG4gIHJldHVybiBidWZcbn1cblxuQnVmZmVyLmlzQnVmZmVyID0gZnVuY3Rpb24gaXNCdWZmZXIgKGIpIHtcbiAgcmV0dXJuICEhKGIgIT0gbnVsbCAmJiBiLl9pc0J1ZmZlcilcbn1cblxuQnVmZmVyLmNvbXBhcmUgPSBmdW5jdGlvbiBjb21wYXJlIChhLCBiKSB7XG4gIGlmICghQnVmZmVyLmlzQnVmZmVyKGEpIHx8ICFCdWZmZXIuaXNCdWZmZXIoYikpIHtcbiAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdBcmd1bWVudHMgbXVzdCBiZSBCdWZmZXJzJylcbiAgfVxuXG4gIGlmIChhID09PSBiKSByZXR1cm4gMFxuXG4gIHZhciB4ID0gYS5sZW5ndGhcbiAgdmFyIHkgPSBiLmxlbmd0aFxuXG4gIHZhciBpID0gMFxuICB2YXIgbGVuID0gTWF0aC5taW4oeCwgeSlcbiAgd2hpbGUgKGkgPCBsZW4pIHtcbiAgICBpZiAoYVtpXSAhPT0gYltpXSkgYnJlYWtcblxuICAgICsraVxuICB9XG5cbiAgaWYgKGkgIT09IGxlbikge1xuICAgIHggPSBhW2ldXG4gICAgeSA9IGJbaV1cbiAgfVxuXG4gIGlmICh4IDwgeSkgcmV0dXJuIC0xXG4gIGlmICh5IDwgeCkgcmV0dXJuIDFcbiAgcmV0dXJuIDBcbn1cblxuQnVmZmVyLmlzRW5jb2RpbmcgPSBmdW5jdGlvbiBpc0VuY29kaW5nIChlbmNvZGluZykge1xuICBzd2l0Y2ggKFN0cmluZyhlbmNvZGluZykudG9Mb3dlckNhc2UoKSkge1xuICAgIGNhc2UgJ2hleCc6XG4gICAgY2FzZSAndXRmOCc6XG4gICAgY2FzZSAndXRmLTgnOlxuICAgIGNhc2UgJ2FzY2lpJzpcbiAgICBjYXNlICdiaW5hcnknOlxuICAgIGNhc2UgJ2Jhc2U2NCc6XG4gICAgY2FzZSAncmF3JzpcbiAgICBjYXNlICd1Y3MyJzpcbiAgICBjYXNlICd1Y3MtMic6XG4gICAgY2FzZSAndXRmMTZsZSc6XG4gICAgY2FzZSAndXRmLTE2bGUnOlxuICAgICAgcmV0dXJuIHRydWVcbiAgICBkZWZhdWx0OlxuICAgICAgcmV0dXJuIGZhbHNlXG4gIH1cbn1cblxuQnVmZmVyLmNvbmNhdCA9IGZ1bmN0aW9uIGNvbmNhdCAobGlzdCwgbGVuZ3RoKSB7XG4gIGlmICghaXNBcnJheShsaXN0KSkgdGhyb3cgbmV3IFR5cGVFcnJvcignbGlzdCBhcmd1bWVudCBtdXN0IGJlIGFuIEFycmF5IG9mIEJ1ZmZlcnMuJylcblxuICBpZiAobGlzdC5sZW5ndGggPT09IDApIHtcbiAgICByZXR1cm4gbmV3IEJ1ZmZlcigwKVxuICB9XG5cbiAgdmFyIGlcbiAgaWYgKGxlbmd0aCA9PT0gdW5kZWZpbmVkKSB7XG4gICAgbGVuZ3RoID0gMFxuICAgIGZvciAoaSA9IDA7IGkgPCBsaXN0Lmxlbmd0aDsgaSsrKSB7XG4gICAgICBsZW5ndGggKz0gbGlzdFtpXS5sZW5ndGhcbiAgICB9XG4gIH1cblxuICB2YXIgYnVmID0gbmV3IEJ1ZmZlcihsZW5ndGgpXG4gIHZhciBwb3MgPSAwXG4gIGZvciAoaSA9IDA7IGkgPCBsaXN0Lmxlbmd0aDsgaSsrKSB7XG4gICAgdmFyIGl0ZW0gPSBsaXN0W2ldXG4gICAgaXRlbS5jb3B5KGJ1ZiwgcG9zKVxuICAgIHBvcyArPSBpdGVtLmxlbmd0aFxuICB9XG4gIHJldHVybiBidWZcbn1cblxuZnVuY3Rpb24gYnl0ZUxlbmd0aCAoc3RyaW5nLCBlbmNvZGluZykge1xuICBpZiAodHlwZW9mIHN0cmluZyAhPT0gJ3N0cmluZycpIHN0cmluZyA9ICcnICsgc3RyaW5nXG5cbiAgdmFyIGxlbiA9IHN0cmluZy5sZW5ndGhcbiAgaWYgKGxlbiA9PT0gMCkgcmV0dXJuIDBcblxuICAvLyBVc2UgYSBmb3IgbG9vcCB0byBhdm9pZCByZWN1cnNpb25cbiAgdmFyIGxvd2VyZWRDYXNlID0gZmFsc2VcbiAgZm9yICg7Oykge1xuICAgIHN3aXRjaCAoZW5jb2RpbmcpIHtcbiAgICAgIGNhc2UgJ2FzY2lpJzpcbiAgICAgIGNhc2UgJ2JpbmFyeSc6XG4gICAgICAvLyBEZXByZWNhdGVkXG4gICAgICBjYXNlICdyYXcnOlxuICAgICAgY2FzZSAncmF3cyc6XG4gICAgICAgIHJldHVybiBsZW5cbiAgICAgIGNhc2UgJ3V0ZjgnOlxuICAgICAgY2FzZSAndXRmLTgnOlxuICAgICAgICByZXR1cm4gdXRmOFRvQnl0ZXMoc3RyaW5nKS5sZW5ndGhcbiAgICAgIGNhc2UgJ3VjczInOlxuICAgICAgY2FzZSAndWNzLTInOlxuICAgICAgY2FzZSAndXRmMTZsZSc6XG4gICAgICBjYXNlICd1dGYtMTZsZSc6XG4gICAgICAgIHJldHVybiBsZW4gKiAyXG4gICAgICBjYXNlICdoZXgnOlxuICAgICAgICByZXR1cm4gbGVuID4+PiAxXG4gICAgICBjYXNlICdiYXNlNjQnOlxuICAgICAgICByZXR1cm4gYmFzZTY0VG9CeXRlcyhzdHJpbmcpLmxlbmd0aFxuICAgICAgZGVmYXVsdDpcbiAgICAgICAgaWYgKGxvd2VyZWRDYXNlKSByZXR1cm4gdXRmOFRvQnl0ZXMoc3RyaW5nKS5sZW5ndGggLy8gYXNzdW1lIHV0ZjhcbiAgICAgICAgZW5jb2RpbmcgPSAoJycgKyBlbmNvZGluZykudG9Mb3dlckNhc2UoKVxuICAgICAgICBsb3dlcmVkQ2FzZSA9IHRydWVcbiAgICB9XG4gIH1cbn1cbkJ1ZmZlci5ieXRlTGVuZ3RoID0gYnl0ZUxlbmd0aFxuXG4vLyBwcmUtc2V0IGZvciB2YWx1ZXMgdGhhdCBtYXkgZXhpc3QgaW4gdGhlIGZ1dHVyZVxuQnVmZmVyLnByb3RvdHlwZS5sZW5ndGggPSB1bmRlZmluZWRcbkJ1ZmZlci5wcm90b3R5cGUucGFyZW50ID0gdW5kZWZpbmVkXG5cbmZ1bmN0aW9uIHNsb3dUb1N0cmluZyAoZW5jb2RpbmcsIHN0YXJ0LCBlbmQpIHtcbiAgdmFyIGxvd2VyZWRDYXNlID0gZmFsc2VcblxuICBzdGFydCA9IHN0YXJ0IHwgMFxuICBlbmQgPSBlbmQgPT09IHVuZGVmaW5lZCB8fCBlbmQgPT09IEluZmluaXR5ID8gdGhpcy5sZW5ndGggOiBlbmQgfCAwXG5cbiAgaWYgKCFlbmNvZGluZykgZW5jb2RpbmcgPSAndXRmOCdcbiAgaWYgKHN0YXJ0IDwgMCkgc3RhcnQgPSAwXG4gIGlmIChlbmQgPiB0aGlzLmxlbmd0aCkgZW5kID0gdGhpcy5sZW5ndGhcbiAgaWYgKGVuZCA8PSBzdGFydCkgcmV0dXJuICcnXG5cbiAgd2hpbGUgKHRydWUpIHtcbiAgICBzd2l0Y2ggKGVuY29kaW5nKSB7XG4gICAgICBjYXNlICdoZXgnOlxuICAgICAgICByZXR1cm4gaGV4U2xpY2UodGhpcywgc3RhcnQsIGVuZClcblxuICAgICAgY2FzZSAndXRmOCc6XG4gICAgICBjYXNlICd1dGYtOCc6XG4gICAgICAgIHJldHVybiB1dGY4U2xpY2UodGhpcywgc3RhcnQsIGVuZClcblxuICAgICAgY2FzZSAnYXNjaWknOlxuICAgICAgICByZXR1cm4gYXNjaWlTbGljZSh0aGlzLCBzdGFydCwgZW5kKVxuXG4gICAgICBjYXNlICdiaW5hcnknOlxuICAgICAgICByZXR1cm4gYmluYXJ5U2xpY2UodGhpcywgc3RhcnQsIGVuZClcblxuICAgICAgY2FzZSAnYmFzZTY0JzpcbiAgICAgICAgcmV0dXJuIGJhc2U2NFNsaWNlKHRoaXMsIHN0YXJ0LCBlbmQpXG5cbiAgICAgIGNhc2UgJ3VjczInOlxuICAgICAgY2FzZSAndWNzLTInOlxuICAgICAgY2FzZSAndXRmMTZsZSc6XG4gICAgICBjYXNlICd1dGYtMTZsZSc6XG4gICAgICAgIHJldHVybiB1dGYxNmxlU2xpY2UodGhpcywgc3RhcnQsIGVuZClcblxuICAgICAgZGVmYXVsdDpcbiAgICAgICAgaWYgKGxvd2VyZWRDYXNlKSB0aHJvdyBuZXcgVHlwZUVycm9yKCdVbmtub3duIGVuY29kaW5nOiAnICsgZW5jb2RpbmcpXG4gICAgICAgIGVuY29kaW5nID0gKGVuY29kaW5nICsgJycpLnRvTG93ZXJDYXNlKClcbiAgICAgICAgbG93ZXJlZENhc2UgPSB0cnVlXG4gICAgfVxuICB9XG59XG5cbkJ1ZmZlci5wcm90b3R5cGUudG9TdHJpbmcgPSBmdW5jdGlvbiB0b1N0cmluZyAoKSB7XG4gIHZhciBsZW5ndGggPSB0aGlzLmxlbmd0aCB8IDBcbiAgaWYgKGxlbmd0aCA9PT0gMCkgcmV0dXJuICcnXG4gIGlmIChhcmd1bWVudHMubGVuZ3RoID09PSAwKSByZXR1cm4gdXRmOFNsaWNlKHRoaXMsIDAsIGxlbmd0aClcbiAgcmV0dXJuIHNsb3dUb1N0cmluZy5hcHBseSh0aGlzLCBhcmd1bWVudHMpXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUuZXF1YWxzID0gZnVuY3Rpb24gZXF1YWxzIChiKSB7XG4gIGlmICghQnVmZmVyLmlzQnVmZmVyKGIpKSB0aHJvdyBuZXcgVHlwZUVycm9yKCdBcmd1bWVudCBtdXN0IGJlIGEgQnVmZmVyJylcbiAgaWYgKHRoaXMgPT09IGIpIHJldHVybiB0cnVlXG4gIHJldHVybiBCdWZmZXIuY29tcGFyZSh0aGlzLCBiKSA9PT0gMFxufVxuXG5CdWZmZXIucHJvdG90eXBlLmluc3BlY3QgPSBmdW5jdGlvbiBpbnNwZWN0ICgpIHtcbiAgdmFyIHN0ciA9ICcnXG4gIHZhciBtYXggPSBleHBvcnRzLklOU1BFQ1RfTUFYX0JZVEVTXG4gIGlmICh0aGlzLmxlbmd0aCA+IDApIHtcbiAgICBzdHIgPSB0aGlzLnRvU3RyaW5nKCdoZXgnLCAwLCBtYXgpLm1hdGNoKC8uezJ9L2cpLmpvaW4oJyAnKVxuICAgIGlmICh0aGlzLmxlbmd0aCA+IG1heCkgc3RyICs9ICcgLi4uICdcbiAgfVxuICByZXR1cm4gJzxCdWZmZXIgJyArIHN0ciArICc+J1xufVxuXG5CdWZmZXIucHJvdG90eXBlLmNvbXBhcmUgPSBmdW5jdGlvbiBjb21wYXJlIChiKSB7XG4gIGlmICghQnVmZmVyLmlzQnVmZmVyKGIpKSB0aHJvdyBuZXcgVHlwZUVycm9yKCdBcmd1bWVudCBtdXN0IGJlIGEgQnVmZmVyJylcbiAgaWYgKHRoaXMgPT09IGIpIHJldHVybiAwXG4gIHJldHVybiBCdWZmZXIuY29tcGFyZSh0aGlzLCBiKVxufVxuXG5CdWZmZXIucHJvdG90eXBlLmluZGV4T2YgPSBmdW5jdGlvbiBpbmRleE9mICh2YWwsIGJ5dGVPZmZzZXQpIHtcbiAgaWYgKGJ5dGVPZmZzZXQgPiAweDdmZmZmZmZmKSBieXRlT2Zmc2V0ID0gMHg3ZmZmZmZmZlxuICBlbHNlIGlmIChieXRlT2Zmc2V0IDwgLTB4ODAwMDAwMDApIGJ5dGVPZmZzZXQgPSAtMHg4MDAwMDAwMFxuICBieXRlT2Zmc2V0ID4+PSAwXG5cbiAgaWYgKHRoaXMubGVuZ3RoID09PSAwKSByZXR1cm4gLTFcbiAgaWYgKGJ5dGVPZmZzZXQgPj0gdGhpcy5sZW5ndGgpIHJldHVybiAtMVxuXG4gIC8vIE5lZ2F0aXZlIG9mZnNldHMgc3RhcnQgZnJvbSB0aGUgZW5kIG9mIHRoZSBidWZmZXJcbiAgaWYgKGJ5dGVPZmZzZXQgPCAwKSBieXRlT2Zmc2V0ID0gTWF0aC5tYXgodGhpcy5sZW5ndGggKyBieXRlT2Zmc2V0LCAwKVxuXG4gIGlmICh0eXBlb2YgdmFsID09PSAnc3RyaW5nJykge1xuICAgIGlmICh2YWwubGVuZ3RoID09PSAwKSByZXR1cm4gLTEgLy8gc3BlY2lhbCBjYXNlOiBsb29raW5nIGZvciBlbXB0eSBzdHJpbmcgYWx3YXlzIGZhaWxzXG4gICAgcmV0dXJuIFN0cmluZy5wcm90b3R5cGUuaW5kZXhPZi5jYWxsKHRoaXMsIHZhbCwgYnl0ZU9mZnNldClcbiAgfVxuICBpZiAoQnVmZmVyLmlzQnVmZmVyKHZhbCkpIHtcbiAgICByZXR1cm4gYXJyYXlJbmRleE9mKHRoaXMsIHZhbCwgYnl0ZU9mZnNldClcbiAgfVxuICBpZiAodHlwZW9mIHZhbCA9PT0gJ251bWJlcicpIHtcbiAgICBpZiAoQnVmZmVyLlRZUEVEX0FSUkFZX1NVUFBPUlQgJiYgVWludDhBcnJheS5wcm90b3R5cGUuaW5kZXhPZiA9PT0gJ2Z1bmN0aW9uJykge1xuICAgICAgcmV0dXJuIFVpbnQ4QXJyYXkucHJvdG90eXBlLmluZGV4T2YuY2FsbCh0aGlzLCB2YWwsIGJ5dGVPZmZzZXQpXG4gICAgfVxuICAgIHJldHVybiBhcnJheUluZGV4T2YodGhpcywgWyB2YWwgXSwgYnl0ZU9mZnNldClcbiAgfVxuXG4gIGZ1bmN0aW9uIGFycmF5SW5kZXhPZiAoYXJyLCB2YWwsIGJ5dGVPZmZzZXQpIHtcbiAgICB2YXIgZm91bmRJbmRleCA9IC0xXG4gICAgZm9yICh2YXIgaSA9IDA7IGJ5dGVPZmZzZXQgKyBpIDwgYXJyLmxlbmd0aDsgaSsrKSB7XG4gICAgICBpZiAoYXJyW2J5dGVPZmZzZXQgKyBpXSA9PT0gdmFsW2ZvdW5kSW5kZXggPT09IC0xID8gMCA6IGkgLSBmb3VuZEluZGV4XSkge1xuICAgICAgICBpZiAoZm91bmRJbmRleCA9PT0gLTEpIGZvdW5kSW5kZXggPSBpXG4gICAgICAgIGlmIChpIC0gZm91bmRJbmRleCArIDEgPT09IHZhbC5sZW5ndGgpIHJldHVybiBieXRlT2Zmc2V0ICsgZm91bmRJbmRleFxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgZm91bmRJbmRleCA9IC0xXG4gICAgICB9XG4gICAgfVxuICAgIHJldHVybiAtMVxuICB9XG5cbiAgdGhyb3cgbmV3IFR5cGVFcnJvcigndmFsIG11c3QgYmUgc3RyaW5nLCBudW1iZXIgb3IgQnVmZmVyJylcbn1cblxuLy8gYGdldGAgaXMgZGVwcmVjYXRlZFxuQnVmZmVyLnByb3RvdHlwZS5nZXQgPSBmdW5jdGlvbiBnZXQgKG9mZnNldCkge1xuICBjb25zb2xlLmxvZygnLmdldCgpIGlzIGRlcHJlY2F0ZWQuIEFjY2VzcyB1c2luZyBhcnJheSBpbmRleGVzIGluc3RlYWQuJylcbiAgcmV0dXJuIHRoaXMucmVhZFVJbnQ4KG9mZnNldClcbn1cblxuLy8gYHNldGAgaXMgZGVwcmVjYXRlZFxuQnVmZmVyLnByb3RvdHlwZS5zZXQgPSBmdW5jdGlvbiBzZXQgKHYsIG9mZnNldCkge1xuICBjb25zb2xlLmxvZygnLnNldCgpIGlzIGRlcHJlY2F0ZWQuIEFjY2VzcyB1c2luZyBhcnJheSBpbmRleGVzIGluc3RlYWQuJylcbiAgcmV0dXJuIHRoaXMud3JpdGVVSW50OCh2LCBvZmZzZXQpXG59XG5cbmZ1bmN0aW9uIGhleFdyaXRlIChidWYsIHN0cmluZywgb2Zmc2V0LCBsZW5ndGgpIHtcbiAgb2Zmc2V0ID0gTnVtYmVyKG9mZnNldCkgfHwgMFxuICB2YXIgcmVtYWluaW5nID0gYnVmLmxlbmd0aCAtIG9mZnNldFxuICBpZiAoIWxlbmd0aCkge1xuICAgIGxlbmd0aCA9IHJlbWFpbmluZ1xuICB9IGVsc2Uge1xuICAgIGxlbmd0aCA9IE51bWJlcihsZW5ndGgpXG4gICAgaWYgKGxlbmd0aCA+IHJlbWFpbmluZykge1xuICAgICAgbGVuZ3RoID0gcmVtYWluaW5nXG4gICAgfVxuICB9XG5cbiAgLy8gbXVzdCBiZSBhbiBldmVuIG51bWJlciBvZiBkaWdpdHNcbiAgdmFyIHN0ckxlbiA9IHN0cmluZy5sZW5ndGhcbiAgaWYgKHN0ckxlbiAlIDIgIT09IDApIHRocm93IG5ldyBFcnJvcignSW52YWxpZCBoZXggc3RyaW5nJylcblxuICBpZiAobGVuZ3RoID4gc3RyTGVuIC8gMikge1xuICAgIGxlbmd0aCA9IHN0ckxlbiAvIDJcbiAgfVxuICBmb3IgKHZhciBpID0gMDsgaSA8IGxlbmd0aDsgaSsrKSB7XG4gICAgdmFyIHBhcnNlZCA9IHBhcnNlSW50KHN0cmluZy5zdWJzdHIoaSAqIDIsIDIpLCAxNilcbiAgICBpZiAoaXNOYU4ocGFyc2VkKSkgdGhyb3cgbmV3IEVycm9yKCdJbnZhbGlkIGhleCBzdHJpbmcnKVxuICAgIGJ1ZltvZmZzZXQgKyBpXSA9IHBhcnNlZFxuICB9XG4gIHJldHVybiBpXG59XG5cbmZ1bmN0aW9uIHV0ZjhXcml0ZSAoYnVmLCBzdHJpbmcsIG9mZnNldCwgbGVuZ3RoKSB7XG4gIHJldHVybiBibGl0QnVmZmVyKHV0ZjhUb0J5dGVzKHN0cmluZywgYnVmLmxlbmd0aCAtIG9mZnNldCksIGJ1Ziwgb2Zmc2V0LCBsZW5ndGgpXG59XG5cbmZ1bmN0aW9uIGFzY2lpV3JpdGUgKGJ1Ziwgc3RyaW5nLCBvZmZzZXQsIGxlbmd0aCkge1xuICByZXR1cm4gYmxpdEJ1ZmZlcihhc2NpaVRvQnl0ZXMoc3RyaW5nKSwgYnVmLCBvZmZzZXQsIGxlbmd0aClcbn1cblxuZnVuY3Rpb24gYmluYXJ5V3JpdGUgKGJ1Ziwgc3RyaW5nLCBvZmZzZXQsIGxlbmd0aCkge1xuICByZXR1cm4gYXNjaWlXcml0ZShidWYsIHN0cmluZywgb2Zmc2V0LCBsZW5ndGgpXG59XG5cbmZ1bmN0aW9uIGJhc2U2NFdyaXRlIChidWYsIHN0cmluZywgb2Zmc2V0LCBsZW5ndGgpIHtcbiAgcmV0dXJuIGJsaXRCdWZmZXIoYmFzZTY0VG9CeXRlcyhzdHJpbmcpLCBidWYsIG9mZnNldCwgbGVuZ3RoKVxufVxuXG5mdW5jdGlvbiB1Y3MyV3JpdGUgKGJ1Ziwgc3RyaW5nLCBvZmZzZXQsIGxlbmd0aCkge1xuICByZXR1cm4gYmxpdEJ1ZmZlcih1dGYxNmxlVG9CeXRlcyhzdHJpbmcsIGJ1Zi5sZW5ndGggLSBvZmZzZXQpLCBidWYsIG9mZnNldCwgbGVuZ3RoKVxufVxuXG5CdWZmZXIucHJvdG90eXBlLndyaXRlID0gZnVuY3Rpb24gd3JpdGUgKHN0cmluZywgb2Zmc2V0LCBsZW5ndGgsIGVuY29kaW5nKSB7XG4gIC8vIEJ1ZmZlciN3cml0ZShzdHJpbmcpXG4gIGlmIChvZmZzZXQgPT09IHVuZGVmaW5lZCkge1xuICAgIGVuY29kaW5nID0gJ3V0ZjgnXG4gICAgbGVuZ3RoID0gdGhpcy5sZW5ndGhcbiAgICBvZmZzZXQgPSAwXG4gIC8vIEJ1ZmZlciN3cml0ZShzdHJpbmcsIGVuY29kaW5nKVxuICB9IGVsc2UgaWYgKGxlbmd0aCA9PT0gdW5kZWZpbmVkICYmIHR5cGVvZiBvZmZzZXQgPT09ICdzdHJpbmcnKSB7XG4gICAgZW5jb2RpbmcgPSBvZmZzZXRcbiAgICBsZW5ndGggPSB0aGlzLmxlbmd0aFxuICAgIG9mZnNldCA9IDBcbiAgLy8gQnVmZmVyI3dyaXRlKHN0cmluZywgb2Zmc2V0WywgbGVuZ3RoXVssIGVuY29kaW5nXSlcbiAgfSBlbHNlIGlmIChpc0Zpbml0ZShvZmZzZXQpKSB7XG4gICAgb2Zmc2V0ID0gb2Zmc2V0IHwgMFxuICAgIGlmIChpc0Zpbml0ZShsZW5ndGgpKSB7XG4gICAgICBsZW5ndGggPSBsZW5ndGggfCAwXG4gICAgICBpZiAoZW5jb2RpbmcgPT09IHVuZGVmaW5lZCkgZW5jb2RpbmcgPSAndXRmOCdcbiAgICB9IGVsc2Uge1xuICAgICAgZW5jb2RpbmcgPSBsZW5ndGhcbiAgICAgIGxlbmd0aCA9IHVuZGVmaW5lZFxuICAgIH1cbiAgLy8gbGVnYWN5IHdyaXRlKHN0cmluZywgZW5jb2RpbmcsIG9mZnNldCwgbGVuZ3RoKSAtIHJlbW92ZSBpbiB2MC4xM1xuICB9IGVsc2Uge1xuICAgIHZhciBzd2FwID0gZW5jb2RpbmdcbiAgICBlbmNvZGluZyA9IG9mZnNldFxuICAgIG9mZnNldCA9IGxlbmd0aCB8IDBcbiAgICBsZW5ndGggPSBzd2FwXG4gIH1cblxuICB2YXIgcmVtYWluaW5nID0gdGhpcy5sZW5ndGggLSBvZmZzZXRcbiAgaWYgKGxlbmd0aCA9PT0gdW5kZWZpbmVkIHx8IGxlbmd0aCA+IHJlbWFpbmluZykgbGVuZ3RoID0gcmVtYWluaW5nXG5cbiAgaWYgKChzdHJpbmcubGVuZ3RoID4gMCAmJiAobGVuZ3RoIDwgMCB8fCBvZmZzZXQgPCAwKSkgfHwgb2Zmc2V0ID4gdGhpcy5sZW5ndGgpIHtcbiAgICB0aHJvdyBuZXcgUmFuZ2VFcnJvcignYXR0ZW1wdCB0byB3cml0ZSBvdXRzaWRlIGJ1ZmZlciBib3VuZHMnKVxuICB9XG5cbiAgaWYgKCFlbmNvZGluZykgZW5jb2RpbmcgPSAndXRmOCdcblxuICB2YXIgbG93ZXJlZENhc2UgPSBmYWxzZVxuICBmb3IgKDs7KSB7XG4gICAgc3dpdGNoIChlbmNvZGluZykge1xuICAgICAgY2FzZSAnaGV4JzpcbiAgICAgICAgcmV0dXJuIGhleFdyaXRlKHRoaXMsIHN0cmluZywgb2Zmc2V0LCBsZW5ndGgpXG5cbiAgICAgIGNhc2UgJ3V0ZjgnOlxuICAgICAgY2FzZSAndXRmLTgnOlxuICAgICAgICByZXR1cm4gdXRmOFdyaXRlKHRoaXMsIHN0cmluZywgb2Zmc2V0LCBsZW5ndGgpXG5cbiAgICAgIGNhc2UgJ2FzY2lpJzpcbiAgICAgICAgcmV0dXJuIGFzY2lpV3JpdGUodGhpcywgc3RyaW5nLCBvZmZzZXQsIGxlbmd0aClcblxuICAgICAgY2FzZSAnYmluYXJ5JzpcbiAgICAgICAgcmV0dXJuIGJpbmFyeVdyaXRlKHRoaXMsIHN0cmluZywgb2Zmc2V0LCBsZW5ndGgpXG5cbiAgICAgIGNhc2UgJ2Jhc2U2NCc6XG4gICAgICAgIC8vIFdhcm5pbmc6IG1heExlbmd0aCBub3QgdGFrZW4gaW50byBhY2NvdW50IGluIGJhc2U2NFdyaXRlXG4gICAgICAgIHJldHVybiBiYXNlNjRXcml0ZSh0aGlzLCBzdHJpbmcsIG9mZnNldCwgbGVuZ3RoKVxuXG4gICAgICBjYXNlICd1Y3MyJzpcbiAgICAgIGNhc2UgJ3Vjcy0yJzpcbiAgICAgIGNhc2UgJ3V0ZjE2bGUnOlxuICAgICAgY2FzZSAndXRmLTE2bGUnOlxuICAgICAgICByZXR1cm4gdWNzMldyaXRlKHRoaXMsIHN0cmluZywgb2Zmc2V0LCBsZW5ndGgpXG5cbiAgICAgIGRlZmF1bHQ6XG4gICAgICAgIGlmIChsb3dlcmVkQ2FzZSkgdGhyb3cgbmV3IFR5cGVFcnJvcignVW5rbm93biBlbmNvZGluZzogJyArIGVuY29kaW5nKVxuICAgICAgICBlbmNvZGluZyA9ICgnJyArIGVuY29kaW5nKS50b0xvd2VyQ2FzZSgpXG4gICAgICAgIGxvd2VyZWRDYXNlID0gdHJ1ZVxuICAgIH1cbiAgfVxufVxuXG5CdWZmZXIucHJvdG90eXBlLnRvSlNPTiA9IGZ1bmN0aW9uIHRvSlNPTiAoKSB7XG4gIHJldHVybiB7XG4gICAgdHlwZTogJ0J1ZmZlcicsXG4gICAgZGF0YTogQXJyYXkucHJvdG90eXBlLnNsaWNlLmNhbGwodGhpcy5fYXJyIHx8IHRoaXMsIDApXG4gIH1cbn1cblxuZnVuY3Rpb24gYmFzZTY0U2xpY2UgKGJ1Ziwgc3RhcnQsIGVuZCkge1xuICBpZiAoc3RhcnQgPT09IDAgJiYgZW5kID09PSBidWYubGVuZ3RoKSB7XG4gICAgcmV0dXJuIGJhc2U2NC5mcm9tQnl0ZUFycmF5KGJ1ZilcbiAgfSBlbHNlIHtcbiAgICByZXR1cm4gYmFzZTY0LmZyb21CeXRlQXJyYXkoYnVmLnNsaWNlKHN0YXJ0LCBlbmQpKVxuICB9XG59XG5cbmZ1bmN0aW9uIHV0ZjhTbGljZSAoYnVmLCBzdGFydCwgZW5kKSB7XG4gIGVuZCA9IE1hdGgubWluKGJ1Zi5sZW5ndGgsIGVuZClcbiAgdmFyIGZpcnN0Qnl0ZVxuICB2YXIgc2Vjb25kQnl0ZVxuICB2YXIgdGhpcmRCeXRlXG4gIHZhciBmb3VydGhCeXRlXG4gIHZhciBieXRlc1BlclNlcXVlbmNlXG4gIHZhciB0ZW1wQ29kZVBvaW50XG4gIHZhciBjb2RlUG9pbnRcbiAgdmFyIHJlcyA9IFtdXG4gIHZhciBpID0gc3RhcnRcblxuICBmb3IgKDsgaSA8IGVuZDsgaSArPSBieXRlc1BlclNlcXVlbmNlKSB7XG4gICAgZmlyc3RCeXRlID0gYnVmW2ldXG4gICAgY29kZVBvaW50ID0gMHhGRkZEXG5cbiAgICBpZiAoZmlyc3RCeXRlID4gMHhFRikge1xuICAgICAgYnl0ZXNQZXJTZXF1ZW5jZSA9IDRcbiAgICB9IGVsc2UgaWYgKGZpcnN0Qnl0ZSA+IDB4REYpIHtcbiAgICAgIGJ5dGVzUGVyU2VxdWVuY2UgPSAzXG4gICAgfSBlbHNlIGlmIChmaXJzdEJ5dGUgPiAweEJGKSB7XG4gICAgICBieXRlc1BlclNlcXVlbmNlID0gMlxuICAgIH0gZWxzZSB7XG4gICAgICBieXRlc1BlclNlcXVlbmNlID0gMVxuICAgIH1cblxuICAgIGlmIChpICsgYnl0ZXNQZXJTZXF1ZW5jZSA8PSBlbmQpIHtcbiAgICAgIHN3aXRjaCAoYnl0ZXNQZXJTZXF1ZW5jZSkge1xuICAgICAgICBjYXNlIDE6XG4gICAgICAgICAgaWYgKGZpcnN0Qnl0ZSA8IDB4ODApIHtcbiAgICAgICAgICAgIGNvZGVQb2ludCA9IGZpcnN0Qnl0ZVxuICAgICAgICAgIH1cbiAgICAgICAgICBicmVha1xuICAgICAgICBjYXNlIDI6XG4gICAgICAgICAgc2Vjb25kQnl0ZSA9IGJ1ZltpICsgMV1cbiAgICAgICAgICBpZiAoKHNlY29uZEJ5dGUgJiAweEMwKSA9PT0gMHg4MCkge1xuICAgICAgICAgICAgdGVtcENvZGVQb2ludCA9IChmaXJzdEJ5dGUgJiAweDFGKSA8PCAweDYgfCAoc2Vjb25kQnl0ZSAmIDB4M0YpXG4gICAgICAgICAgICBpZiAodGVtcENvZGVQb2ludCA+IDB4N0YpIHtcbiAgICAgICAgICAgICAgY29kZVBvaW50ID0gdGVtcENvZGVQb2ludFxuICAgICAgICAgICAgfVxuICAgICAgICAgIH1cbiAgICAgICAgICBicmVha1xuICAgICAgICBjYXNlIDM6XG4gICAgICAgICAgc2Vjb25kQnl0ZSA9IGJ1ZltpICsgMV1cbiAgICAgICAgICB0aGlyZEJ5dGUgPSBidWZbaSArIDJdXG4gICAgICAgICAgaWYgKChzZWNvbmRCeXRlICYgMHhDMCkgPT09IDB4ODAgJiYgKHRoaXJkQnl0ZSAmIDB4QzApID09PSAweDgwKSB7XG4gICAgICAgICAgICB0ZW1wQ29kZVBvaW50ID0gKGZpcnN0Qnl0ZSAmIDB4RikgPDwgMHhDIHwgKHNlY29uZEJ5dGUgJiAweDNGKSA8PCAweDYgfCAodGhpcmRCeXRlICYgMHgzRilcbiAgICAgICAgICAgIGlmICh0ZW1wQ29kZVBvaW50ID4gMHg3RkYgJiYgKHRlbXBDb2RlUG9pbnQgPCAweEQ4MDAgfHwgdGVtcENvZGVQb2ludCA+IDB4REZGRikpIHtcbiAgICAgICAgICAgICAgY29kZVBvaW50ID0gdGVtcENvZGVQb2ludFxuICAgICAgICAgICAgfVxuICAgICAgICAgIH1cbiAgICAgICAgICBicmVha1xuICAgICAgICBjYXNlIDQ6XG4gICAgICAgICAgc2Vjb25kQnl0ZSA9IGJ1ZltpICsgMV1cbiAgICAgICAgICB0aGlyZEJ5dGUgPSBidWZbaSArIDJdXG4gICAgICAgICAgZm91cnRoQnl0ZSA9IGJ1ZltpICsgM11cbiAgICAgICAgICBpZiAoKHNlY29uZEJ5dGUgJiAweEMwKSA9PT0gMHg4MCAmJiAodGhpcmRCeXRlICYgMHhDMCkgPT09IDB4ODAgJiYgKGZvdXJ0aEJ5dGUgJiAweEMwKSA9PT0gMHg4MCkge1xuICAgICAgICAgICAgdGVtcENvZGVQb2ludCA9IChmaXJzdEJ5dGUgJiAweEYpIDw8IDB4MTIgfCAoc2Vjb25kQnl0ZSAmIDB4M0YpIDw8IDB4QyB8ICh0aGlyZEJ5dGUgJiAweDNGKSA8PCAweDYgfCAoZm91cnRoQnl0ZSAmIDB4M0YpXG4gICAgICAgICAgICBpZiAodGVtcENvZGVQb2ludCA+IDB4RkZGRiAmJiB0ZW1wQ29kZVBvaW50IDwgMHgxMTAwMDApIHtcbiAgICAgICAgICAgICAgY29kZVBvaW50ID0gdGVtcENvZGVQb2ludFxuICAgICAgICAgICAgfVxuICAgICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAoY29kZVBvaW50ID09PSAweEZGRkQpIHtcbiAgICAgIC8vIHdlIGdlbmVyYXRlZCBhbiBpbnZhbGlkIGNvZGVQb2ludCBzbyBtYWtlIHN1cmUgdG8gb25seSBhZHZhbmNlIGJ5IDEgYnl0ZVxuICAgICAgYnl0ZXNQZXJTZXF1ZW5jZSA9IDFcbiAgICB9IGVsc2UgaWYgKGNvZGVQb2ludCA+IDB4RkZGRikge1xuICAgICAgLy8gZW5jb2RlIHRvIHV0ZjE2IChzdXJyb2dhdGUgcGFpciBkYW5jZSlcbiAgICAgIGNvZGVQb2ludCAtPSAweDEwMDAwXG4gICAgICByZXMucHVzaChjb2RlUG9pbnQgPj4+IDEwICYgMHgzRkYgfCAweEQ4MDApXG4gICAgICBjb2RlUG9pbnQgPSAweERDMDAgfCBjb2RlUG9pbnQgJiAweDNGRlxuICAgIH1cblxuICAgIHJlcy5wdXNoKGNvZGVQb2ludClcbiAgfVxuXG4gIHJldHVybiBTdHJpbmcuZnJvbUNoYXJDb2RlLmFwcGx5KFN0cmluZywgcmVzKVxufVxuXG5mdW5jdGlvbiBhc2NpaVNsaWNlIChidWYsIHN0YXJ0LCBlbmQpIHtcbiAgdmFyIHJldCA9ICcnXG4gIGVuZCA9IE1hdGgubWluKGJ1Zi5sZW5ndGgsIGVuZClcblxuICBmb3IgKHZhciBpID0gc3RhcnQ7IGkgPCBlbmQ7IGkrKykge1xuICAgIHJldCArPSBTdHJpbmcuZnJvbUNoYXJDb2RlKGJ1ZltpXSAmIDB4N0YpXG4gIH1cbiAgcmV0dXJuIHJldFxufVxuXG5mdW5jdGlvbiBiaW5hcnlTbGljZSAoYnVmLCBzdGFydCwgZW5kKSB7XG4gIHZhciByZXQgPSAnJ1xuICBlbmQgPSBNYXRoLm1pbihidWYubGVuZ3RoLCBlbmQpXG5cbiAgZm9yICh2YXIgaSA9IHN0YXJ0OyBpIDwgZW5kOyBpKyspIHtcbiAgICByZXQgKz0gU3RyaW5nLmZyb21DaGFyQ29kZShidWZbaV0pXG4gIH1cbiAgcmV0dXJuIHJldFxufVxuXG5mdW5jdGlvbiBoZXhTbGljZSAoYnVmLCBzdGFydCwgZW5kKSB7XG4gIHZhciBsZW4gPSBidWYubGVuZ3RoXG5cbiAgaWYgKCFzdGFydCB8fCBzdGFydCA8IDApIHN0YXJ0ID0gMFxuICBpZiAoIWVuZCB8fCBlbmQgPCAwIHx8IGVuZCA+IGxlbikgZW5kID0gbGVuXG5cbiAgdmFyIG91dCA9ICcnXG4gIGZvciAodmFyIGkgPSBzdGFydDsgaSA8IGVuZDsgaSsrKSB7XG4gICAgb3V0ICs9IHRvSGV4KGJ1ZltpXSlcbiAgfVxuICByZXR1cm4gb3V0XG59XG5cbmZ1bmN0aW9uIHV0ZjE2bGVTbGljZSAoYnVmLCBzdGFydCwgZW5kKSB7XG4gIHZhciBieXRlcyA9IGJ1Zi5zbGljZShzdGFydCwgZW5kKVxuICB2YXIgcmVzID0gJydcbiAgZm9yICh2YXIgaSA9IDA7IGkgPCBieXRlcy5sZW5ndGg7IGkgKz0gMikge1xuICAgIHJlcyArPSBTdHJpbmcuZnJvbUNoYXJDb2RlKGJ5dGVzW2ldICsgYnl0ZXNbaSArIDFdICogMjU2KVxuICB9XG4gIHJldHVybiByZXNcbn1cblxuQnVmZmVyLnByb3RvdHlwZS5zbGljZSA9IGZ1bmN0aW9uIHNsaWNlIChzdGFydCwgZW5kKSB7XG4gIHZhciBsZW4gPSB0aGlzLmxlbmd0aFxuICBzdGFydCA9IH5+c3RhcnRcbiAgZW5kID0gZW5kID09PSB1bmRlZmluZWQgPyBsZW4gOiB+fmVuZFxuXG4gIGlmIChzdGFydCA8IDApIHtcbiAgICBzdGFydCArPSBsZW5cbiAgICBpZiAoc3RhcnQgPCAwKSBzdGFydCA9IDBcbiAgfSBlbHNlIGlmIChzdGFydCA+IGxlbikge1xuICAgIHN0YXJ0ID0gbGVuXG4gIH1cblxuICBpZiAoZW5kIDwgMCkge1xuICAgIGVuZCArPSBsZW5cbiAgICBpZiAoZW5kIDwgMCkgZW5kID0gMFxuICB9IGVsc2UgaWYgKGVuZCA+IGxlbikge1xuICAgIGVuZCA9IGxlblxuICB9XG5cbiAgaWYgKGVuZCA8IHN0YXJ0KSBlbmQgPSBzdGFydFxuXG4gIHZhciBuZXdCdWZcbiAgaWYgKEJ1ZmZlci5UWVBFRF9BUlJBWV9TVVBQT1JUKSB7XG4gICAgbmV3QnVmID0gQnVmZmVyLl9hdWdtZW50KHRoaXMuc3ViYXJyYXkoc3RhcnQsIGVuZCkpXG4gIH0gZWxzZSB7XG4gICAgdmFyIHNsaWNlTGVuID0gZW5kIC0gc3RhcnRcbiAgICBuZXdCdWYgPSBuZXcgQnVmZmVyKHNsaWNlTGVuLCB1bmRlZmluZWQpXG4gICAgZm9yICh2YXIgaSA9IDA7IGkgPCBzbGljZUxlbjsgaSsrKSB7XG4gICAgICBuZXdCdWZbaV0gPSB0aGlzW2kgKyBzdGFydF1cbiAgICB9XG4gIH1cblxuICBpZiAobmV3QnVmLmxlbmd0aCkgbmV3QnVmLnBhcmVudCA9IHRoaXMucGFyZW50IHx8IHRoaXNcblxuICByZXR1cm4gbmV3QnVmXG59XG5cbi8qXG4gKiBOZWVkIHRvIG1ha2Ugc3VyZSB0aGF0IGJ1ZmZlciBpc24ndCB0cnlpbmcgdG8gd3JpdGUgb3V0IG9mIGJvdW5kcy5cbiAqL1xuZnVuY3Rpb24gY2hlY2tPZmZzZXQgKG9mZnNldCwgZXh0LCBsZW5ndGgpIHtcbiAgaWYgKChvZmZzZXQgJSAxKSAhPT0gMCB8fCBvZmZzZXQgPCAwKSB0aHJvdyBuZXcgUmFuZ2VFcnJvcignb2Zmc2V0IGlzIG5vdCB1aW50JylcbiAgaWYgKG9mZnNldCArIGV4dCA+IGxlbmd0aCkgdGhyb3cgbmV3IFJhbmdlRXJyb3IoJ1RyeWluZyB0byBhY2Nlc3MgYmV5b25kIGJ1ZmZlciBsZW5ndGgnKVxufVxuXG5CdWZmZXIucHJvdG90eXBlLnJlYWRVSW50TEUgPSBmdW5jdGlvbiByZWFkVUludExFIChvZmZzZXQsIGJ5dGVMZW5ndGgsIG5vQXNzZXJ0KSB7XG4gIG9mZnNldCA9IG9mZnNldCB8IDBcbiAgYnl0ZUxlbmd0aCA9IGJ5dGVMZW5ndGggfCAwXG4gIGlmICghbm9Bc3NlcnQpIGNoZWNrT2Zmc2V0KG9mZnNldCwgYnl0ZUxlbmd0aCwgdGhpcy5sZW5ndGgpXG5cbiAgdmFyIHZhbCA9IHRoaXNbb2Zmc2V0XVxuICB2YXIgbXVsID0gMVxuICB2YXIgaSA9IDBcbiAgd2hpbGUgKCsraSA8IGJ5dGVMZW5ndGggJiYgKG11bCAqPSAweDEwMCkpIHtcbiAgICB2YWwgKz0gdGhpc1tvZmZzZXQgKyBpXSAqIG11bFxuICB9XG5cbiAgcmV0dXJuIHZhbFxufVxuXG5CdWZmZXIucHJvdG90eXBlLnJlYWRVSW50QkUgPSBmdW5jdGlvbiByZWFkVUludEJFIChvZmZzZXQsIGJ5dGVMZW5ndGgsIG5vQXNzZXJ0KSB7XG4gIG9mZnNldCA9IG9mZnNldCB8IDBcbiAgYnl0ZUxlbmd0aCA9IGJ5dGVMZW5ndGggfCAwXG4gIGlmICghbm9Bc3NlcnQpIHtcbiAgICBjaGVja09mZnNldChvZmZzZXQsIGJ5dGVMZW5ndGgsIHRoaXMubGVuZ3RoKVxuICB9XG5cbiAgdmFyIHZhbCA9IHRoaXNbb2Zmc2V0ICsgLS1ieXRlTGVuZ3RoXVxuICB2YXIgbXVsID0gMVxuICB3aGlsZSAoYnl0ZUxlbmd0aCA+IDAgJiYgKG11bCAqPSAweDEwMCkpIHtcbiAgICB2YWwgKz0gdGhpc1tvZmZzZXQgKyAtLWJ5dGVMZW5ndGhdICogbXVsXG4gIH1cblxuICByZXR1cm4gdmFsXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUucmVhZFVJbnQ4ID0gZnVuY3Rpb24gcmVhZFVJbnQ4IChvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIGlmICghbm9Bc3NlcnQpIGNoZWNrT2Zmc2V0KG9mZnNldCwgMSwgdGhpcy5sZW5ndGgpXG4gIHJldHVybiB0aGlzW29mZnNldF1cbn1cblxuQnVmZmVyLnByb3RvdHlwZS5yZWFkVUludDE2TEUgPSBmdW5jdGlvbiByZWFkVUludDE2TEUgKG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgaWYgKCFub0Fzc2VydCkgY2hlY2tPZmZzZXQob2Zmc2V0LCAyLCB0aGlzLmxlbmd0aClcbiAgcmV0dXJuIHRoaXNbb2Zmc2V0XSB8ICh0aGlzW29mZnNldCArIDFdIDw8IDgpXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUucmVhZFVJbnQxNkJFID0gZnVuY3Rpb24gcmVhZFVJbnQxNkJFIChvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIGlmICghbm9Bc3NlcnQpIGNoZWNrT2Zmc2V0KG9mZnNldCwgMiwgdGhpcy5sZW5ndGgpXG4gIHJldHVybiAodGhpc1tvZmZzZXRdIDw8IDgpIHwgdGhpc1tvZmZzZXQgKyAxXVxufVxuXG5CdWZmZXIucHJvdG90eXBlLnJlYWRVSW50MzJMRSA9IGZ1bmN0aW9uIHJlYWRVSW50MzJMRSAob2Zmc2V0LCBub0Fzc2VydCkge1xuICBpZiAoIW5vQXNzZXJ0KSBjaGVja09mZnNldChvZmZzZXQsIDQsIHRoaXMubGVuZ3RoKVxuXG4gIHJldHVybiAoKHRoaXNbb2Zmc2V0XSkgfFxuICAgICAgKHRoaXNbb2Zmc2V0ICsgMV0gPDwgOCkgfFxuICAgICAgKHRoaXNbb2Zmc2V0ICsgMl0gPDwgMTYpKSArXG4gICAgICAodGhpc1tvZmZzZXQgKyAzXSAqIDB4MTAwMDAwMClcbn1cblxuQnVmZmVyLnByb3RvdHlwZS5yZWFkVUludDMyQkUgPSBmdW5jdGlvbiByZWFkVUludDMyQkUgKG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgaWYgKCFub0Fzc2VydCkgY2hlY2tPZmZzZXQob2Zmc2V0LCA0LCB0aGlzLmxlbmd0aClcblxuICByZXR1cm4gKHRoaXNbb2Zmc2V0XSAqIDB4MTAwMDAwMCkgK1xuICAgICgodGhpc1tvZmZzZXQgKyAxXSA8PCAxNikgfFxuICAgICh0aGlzW29mZnNldCArIDJdIDw8IDgpIHxcbiAgICB0aGlzW29mZnNldCArIDNdKVxufVxuXG5CdWZmZXIucHJvdG90eXBlLnJlYWRJbnRMRSA9IGZ1bmN0aW9uIHJlYWRJbnRMRSAob2Zmc2V0LCBieXRlTGVuZ3RoLCBub0Fzc2VydCkge1xuICBvZmZzZXQgPSBvZmZzZXQgfCAwXG4gIGJ5dGVMZW5ndGggPSBieXRlTGVuZ3RoIHwgMFxuICBpZiAoIW5vQXNzZXJ0KSBjaGVja09mZnNldChvZmZzZXQsIGJ5dGVMZW5ndGgsIHRoaXMubGVuZ3RoKVxuXG4gIHZhciB2YWwgPSB0aGlzW29mZnNldF1cbiAgdmFyIG11bCA9IDFcbiAgdmFyIGkgPSAwXG4gIHdoaWxlICgrK2kgPCBieXRlTGVuZ3RoICYmIChtdWwgKj0gMHgxMDApKSB7XG4gICAgdmFsICs9IHRoaXNbb2Zmc2V0ICsgaV0gKiBtdWxcbiAgfVxuICBtdWwgKj0gMHg4MFxuXG4gIGlmICh2YWwgPj0gbXVsKSB2YWwgLT0gTWF0aC5wb3coMiwgOCAqIGJ5dGVMZW5ndGgpXG5cbiAgcmV0dXJuIHZhbFxufVxuXG5CdWZmZXIucHJvdG90eXBlLnJlYWRJbnRCRSA9IGZ1bmN0aW9uIHJlYWRJbnRCRSAob2Zmc2V0LCBieXRlTGVuZ3RoLCBub0Fzc2VydCkge1xuICBvZmZzZXQgPSBvZmZzZXQgfCAwXG4gIGJ5dGVMZW5ndGggPSBieXRlTGVuZ3RoIHwgMFxuICBpZiAoIW5vQXNzZXJ0KSBjaGVja09mZnNldChvZmZzZXQsIGJ5dGVMZW5ndGgsIHRoaXMubGVuZ3RoKVxuXG4gIHZhciBpID0gYnl0ZUxlbmd0aFxuICB2YXIgbXVsID0gMVxuICB2YXIgdmFsID0gdGhpc1tvZmZzZXQgKyAtLWldXG4gIHdoaWxlIChpID4gMCAmJiAobXVsICo9IDB4MTAwKSkge1xuICAgIHZhbCArPSB0aGlzW29mZnNldCArIC0taV0gKiBtdWxcbiAgfVxuICBtdWwgKj0gMHg4MFxuXG4gIGlmICh2YWwgPj0gbXVsKSB2YWwgLT0gTWF0aC5wb3coMiwgOCAqIGJ5dGVMZW5ndGgpXG5cbiAgcmV0dXJuIHZhbFxufVxuXG5CdWZmZXIucHJvdG90eXBlLnJlYWRJbnQ4ID0gZnVuY3Rpb24gcmVhZEludDggKG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgaWYgKCFub0Fzc2VydCkgY2hlY2tPZmZzZXQob2Zmc2V0LCAxLCB0aGlzLmxlbmd0aClcbiAgaWYgKCEodGhpc1tvZmZzZXRdICYgMHg4MCkpIHJldHVybiAodGhpc1tvZmZzZXRdKVxuICByZXR1cm4gKCgweGZmIC0gdGhpc1tvZmZzZXRdICsgMSkgKiAtMSlcbn1cblxuQnVmZmVyLnByb3RvdHlwZS5yZWFkSW50MTZMRSA9IGZ1bmN0aW9uIHJlYWRJbnQxNkxFIChvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIGlmICghbm9Bc3NlcnQpIGNoZWNrT2Zmc2V0KG9mZnNldCwgMiwgdGhpcy5sZW5ndGgpXG4gIHZhciB2YWwgPSB0aGlzW29mZnNldF0gfCAodGhpc1tvZmZzZXQgKyAxXSA8PCA4KVxuICByZXR1cm4gKHZhbCAmIDB4ODAwMCkgPyB2YWwgfCAweEZGRkYwMDAwIDogdmFsXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUucmVhZEludDE2QkUgPSBmdW5jdGlvbiByZWFkSW50MTZCRSAob2Zmc2V0LCBub0Fzc2VydCkge1xuICBpZiAoIW5vQXNzZXJ0KSBjaGVja09mZnNldChvZmZzZXQsIDIsIHRoaXMubGVuZ3RoKVxuICB2YXIgdmFsID0gdGhpc1tvZmZzZXQgKyAxXSB8ICh0aGlzW29mZnNldF0gPDwgOClcbiAgcmV0dXJuICh2YWwgJiAweDgwMDApID8gdmFsIHwgMHhGRkZGMDAwMCA6IHZhbFxufVxuXG5CdWZmZXIucHJvdG90eXBlLnJlYWRJbnQzMkxFID0gZnVuY3Rpb24gcmVhZEludDMyTEUgKG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgaWYgKCFub0Fzc2VydCkgY2hlY2tPZmZzZXQob2Zmc2V0LCA0LCB0aGlzLmxlbmd0aClcblxuICByZXR1cm4gKHRoaXNbb2Zmc2V0XSkgfFxuICAgICh0aGlzW29mZnNldCArIDFdIDw8IDgpIHxcbiAgICAodGhpc1tvZmZzZXQgKyAyXSA8PCAxNikgfFxuICAgICh0aGlzW29mZnNldCArIDNdIDw8IDI0KVxufVxuXG5CdWZmZXIucHJvdG90eXBlLnJlYWRJbnQzMkJFID0gZnVuY3Rpb24gcmVhZEludDMyQkUgKG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgaWYgKCFub0Fzc2VydCkgY2hlY2tPZmZzZXQob2Zmc2V0LCA0LCB0aGlzLmxlbmd0aClcblxuICByZXR1cm4gKHRoaXNbb2Zmc2V0XSA8PCAyNCkgfFxuICAgICh0aGlzW29mZnNldCArIDFdIDw8IDE2KSB8XG4gICAgKHRoaXNbb2Zmc2V0ICsgMl0gPDwgOCkgfFxuICAgICh0aGlzW29mZnNldCArIDNdKVxufVxuXG5CdWZmZXIucHJvdG90eXBlLnJlYWRGbG9hdExFID0gZnVuY3Rpb24gcmVhZEZsb2F0TEUgKG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgaWYgKCFub0Fzc2VydCkgY2hlY2tPZmZzZXQob2Zmc2V0LCA0LCB0aGlzLmxlbmd0aClcbiAgcmV0dXJuIGllZWU3NTQucmVhZCh0aGlzLCBvZmZzZXQsIHRydWUsIDIzLCA0KVxufVxuXG5CdWZmZXIucHJvdG90eXBlLnJlYWRGbG9hdEJFID0gZnVuY3Rpb24gcmVhZEZsb2F0QkUgKG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgaWYgKCFub0Fzc2VydCkgY2hlY2tPZmZzZXQob2Zmc2V0LCA0LCB0aGlzLmxlbmd0aClcbiAgcmV0dXJuIGllZWU3NTQucmVhZCh0aGlzLCBvZmZzZXQsIGZhbHNlLCAyMywgNClcbn1cblxuQnVmZmVyLnByb3RvdHlwZS5yZWFkRG91YmxlTEUgPSBmdW5jdGlvbiByZWFkRG91YmxlTEUgKG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgaWYgKCFub0Fzc2VydCkgY2hlY2tPZmZzZXQob2Zmc2V0LCA4LCB0aGlzLmxlbmd0aClcbiAgcmV0dXJuIGllZWU3NTQucmVhZCh0aGlzLCBvZmZzZXQsIHRydWUsIDUyLCA4KVxufVxuXG5CdWZmZXIucHJvdG90eXBlLnJlYWREb3VibGVCRSA9IGZ1bmN0aW9uIHJlYWREb3VibGVCRSAob2Zmc2V0LCBub0Fzc2VydCkge1xuICBpZiAoIW5vQXNzZXJ0KSBjaGVja09mZnNldChvZmZzZXQsIDgsIHRoaXMubGVuZ3RoKVxuICByZXR1cm4gaWVlZTc1NC5yZWFkKHRoaXMsIG9mZnNldCwgZmFsc2UsIDUyLCA4KVxufVxuXG5mdW5jdGlvbiBjaGVja0ludCAoYnVmLCB2YWx1ZSwgb2Zmc2V0LCBleHQsIG1heCwgbWluKSB7XG4gIGlmICghQnVmZmVyLmlzQnVmZmVyKGJ1ZikpIHRocm93IG5ldyBUeXBlRXJyb3IoJ2J1ZmZlciBtdXN0IGJlIGEgQnVmZmVyIGluc3RhbmNlJylcbiAgaWYgKHZhbHVlID4gbWF4IHx8IHZhbHVlIDwgbWluKSB0aHJvdyBuZXcgUmFuZ2VFcnJvcigndmFsdWUgaXMgb3V0IG9mIGJvdW5kcycpXG4gIGlmIChvZmZzZXQgKyBleHQgPiBidWYubGVuZ3RoKSB0aHJvdyBuZXcgUmFuZ2VFcnJvcignaW5kZXggb3V0IG9mIHJhbmdlJylcbn1cblxuQnVmZmVyLnByb3RvdHlwZS53cml0ZVVJbnRMRSA9IGZ1bmN0aW9uIHdyaXRlVUludExFICh2YWx1ZSwgb2Zmc2V0LCBieXRlTGVuZ3RoLCBub0Fzc2VydCkge1xuICB2YWx1ZSA9ICt2YWx1ZVxuICBvZmZzZXQgPSBvZmZzZXQgfCAwXG4gIGJ5dGVMZW5ndGggPSBieXRlTGVuZ3RoIHwgMFxuICBpZiAoIW5vQXNzZXJ0KSBjaGVja0ludCh0aGlzLCB2YWx1ZSwgb2Zmc2V0LCBieXRlTGVuZ3RoLCBNYXRoLnBvdygyLCA4ICogYnl0ZUxlbmd0aCksIDApXG5cbiAgdmFyIG11bCA9IDFcbiAgdmFyIGkgPSAwXG4gIHRoaXNbb2Zmc2V0XSA9IHZhbHVlICYgMHhGRlxuICB3aGlsZSAoKytpIDwgYnl0ZUxlbmd0aCAmJiAobXVsICo9IDB4MTAwKSkge1xuICAgIHRoaXNbb2Zmc2V0ICsgaV0gPSAodmFsdWUgLyBtdWwpICYgMHhGRlxuICB9XG5cbiAgcmV0dXJuIG9mZnNldCArIGJ5dGVMZW5ndGhcbn1cblxuQnVmZmVyLnByb3RvdHlwZS53cml0ZVVJbnRCRSA9IGZ1bmN0aW9uIHdyaXRlVUludEJFICh2YWx1ZSwgb2Zmc2V0LCBieXRlTGVuZ3RoLCBub0Fzc2VydCkge1xuICB2YWx1ZSA9ICt2YWx1ZVxuICBvZmZzZXQgPSBvZmZzZXQgfCAwXG4gIGJ5dGVMZW5ndGggPSBieXRlTGVuZ3RoIHwgMFxuICBpZiAoIW5vQXNzZXJ0KSBjaGVja0ludCh0aGlzLCB2YWx1ZSwgb2Zmc2V0LCBieXRlTGVuZ3RoLCBNYXRoLnBvdygyLCA4ICogYnl0ZUxlbmd0aCksIDApXG5cbiAgdmFyIGkgPSBieXRlTGVuZ3RoIC0gMVxuICB2YXIgbXVsID0gMVxuICB0aGlzW29mZnNldCArIGldID0gdmFsdWUgJiAweEZGXG4gIHdoaWxlICgtLWkgPj0gMCAmJiAobXVsICo9IDB4MTAwKSkge1xuICAgIHRoaXNbb2Zmc2V0ICsgaV0gPSAodmFsdWUgLyBtdWwpICYgMHhGRlxuICB9XG5cbiAgcmV0dXJuIG9mZnNldCArIGJ5dGVMZW5ndGhcbn1cblxuQnVmZmVyLnByb3RvdHlwZS53cml0ZVVJbnQ4ID0gZnVuY3Rpb24gd3JpdGVVSW50OCAodmFsdWUsIG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgdmFsdWUgPSArdmFsdWVcbiAgb2Zmc2V0ID0gb2Zmc2V0IHwgMFxuICBpZiAoIW5vQXNzZXJ0KSBjaGVja0ludCh0aGlzLCB2YWx1ZSwgb2Zmc2V0LCAxLCAweGZmLCAwKVxuICBpZiAoIUJ1ZmZlci5UWVBFRF9BUlJBWV9TVVBQT1JUKSB2YWx1ZSA9IE1hdGguZmxvb3IodmFsdWUpXG4gIHRoaXNbb2Zmc2V0XSA9IHZhbHVlXG4gIHJldHVybiBvZmZzZXQgKyAxXG59XG5cbmZ1bmN0aW9uIG9iamVjdFdyaXRlVUludDE2IChidWYsIHZhbHVlLCBvZmZzZXQsIGxpdHRsZUVuZGlhbikge1xuICBpZiAodmFsdWUgPCAwKSB2YWx1ZSA9IDB4ZmZmZiArIHZhbHVlICsgMVxuICBmb3IgKHZhciBpID0gMCwgaiA9IE1hdGgubWluKGJ1Zi5sZW5ndGggLSBvZmZzZXQsIDIpOyBpIDwgajsgaSsrKSB7XG4gICAgYnVmW29mZnNldCArIGldID0gKHZhbHVlICYgKDB4ZmYgPDwgKDggKiAobGl0dGxlRW5kaWFuID8gaSA6IDEgLSBpKSkpKSA+Pj5cbiAgICAgIChsaXR0bGVFbmRpYW4gPyBpIDogMSAtIGkpICogOFxuICB9XG59XG5cbkJ1ZmZlci5wcm90b3R5cGUud3JpdGVVSW50MTZMRSA9IGZ1bmN0aW9uIHdyaXRlVUludDE2TEUgKHZhbHVlLCBvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIHZhbHVlID0gK3ZhbHVlXG4gIG9mZnNldCA9IG9mZnNldCB8IDBcbiAgaWYgKCFub0Fzc2VydCkgY2hlY2tJbnQodGhpcywgdmFsdWUsIG9mZnNldCwgMiwgMHhmZmZmLCAwKVxuICBpZiAoQnVmZmVyLlRZUEVEX0FSUkFZX1NVUFBPUlQpIHtcbiAgICB0aGlzW29mZnNldF0gPSB2YWx1ZVxuICAgIHRoaXNbb2Zmc2V0ICsgMV0gPSAodmFsdWUgPj4+IDgpXG4gIH0gZWxzZSB7XG4gICAgb2JqZWN0V3JpdGVVSW50MTYodGhpcywgdmFsdWUsIG9mZnNldCwgdHJ1ZSlcbiAgfVxuICByZXR1cm4gb2Zmc2V0ICsgMlxufVxuXG5CdWZmZXIucHJvdG90eXBlLndyaXRlVUludDE2QkUgPSBmdW5jdGlvbiB3cml0ZVVJbnQxNkJFICh2YWx1ZSwgb2Zmc2V0LCBub0Fzc2VydCkge1xuICB2YWx1ZSA9ICt2YWx1ZVxuICBvZmZzZXQgPSBvZmZzZXQgfCAwXG4gIGlmICghbm9Bc3NlcnQpIGNoZWNrSW50KHRoaXMsIHZhbHVlLCBvZmZzZXQsIDIsIDB4ZmZmZiwgMClcbiAgaWYgKEJ1ZmZlci5UWVBFRF9BUlJBWV9TVVBQT1JUKSB7XG4gICAgdGhpc1tvZmZzZXRdID0gKHZhbHVlID4+PiA4KVxuICAgIHRoaXNbb2Zmc2V0ICsgMV0gPSB2YWx1ZVxuICB9IGVsc2Uge1xuICAgIG9iamVjdFdyaXRlVUludDE2KHRoaXMsIHZhbHVlLCBvZmZzZXQsIGZhbHNlKVxuICB9XG4gIHJldHVybiBvZmZzZXQgKyAyXG59XG5cbmZ1bmN0aW9uIG9iamVjdFdyaXRlVUludDMyIChidWYsIHZhbHVlLCBvZmZzZXQsIGxpdHRsZUVuZGlhbikge1xuICBpZiAodmFsdWUgPCAwKSB2YWx1ZSA9IDB4ZmZmZmZmZmYgKyB2YWx1ZSArIDFcbiAgZm9yICh2YXIgaSA9IDAsIGogPSBNYXRoLm1pbihidWYubGVuZ3RoIC0gb2Zmc2V0LCA0KTsgaSA8IGo7IGkrKykge1xuICAgIGJ1ZltvZmZzZXQgKyBpXSA9ICh2YWx1ZSA+Pj4gKGxpdHRsZUVuZGlhbiA/IGkgOiAzIC0gaSkgKiA4KSAmIDB4ZmZcbiAgfVxufVxuXG5CdWZmZXIucHJvdG90eXBlLndyaXRlVUludDMyTEUgPSBmdW5jdGlvbiB3cml0ZVVJbnQzMkxFICh2YWx1ZSwgb2Zmc2V0LCBub0Fzc2VydCkge1xuICB2YWx1ZSA9ICt2YWx1ZVxuICBvZmZzZXQgPSBvZmZzZXQgfCAwXG4gIGlmICghbm9Bc3NlcnQpIGNoZWNrSW50KHRoaXMsIHZhbHVlLCBvZmZzZXQsIDQsIDB4ZmZmZmZmZmYsIDApXG4gIGlmIChCdWZmZXIuVFlQRURfQVJSQVlfU1VQUE9SVCkge1xuICAgIHRoaXNbb2Zmc2V0ICsgM10gPSAodmFsdWUgPj4+IDI0KVxuICAgIHRoaXNbb2Zmc2V0ICsgMl0gPSAodmFsdWUgPj4+IDE2KVxuICAgIHRoaXNbb2Zmc2V0ICsgMV0gPSAodmFsdWUgPj4+IDgpXG4gICAgdGhpc1tvZmZzZXRdID0gdmFsdWVcbiAgfSBlbHNlIHtcbiAgICBvYmplY3RXcml0ZVVJbnQzMih0aGlzLCB2YWx1ZSwgb2Zmc2V0LCB0cnVlKVxuICB9XG4gIHJldHVybiBvZmZzZXQgKyA0XG59XG5cbkJ1ZmZlci5wcm90b3R5cGUud3JpdGVVSW50MzJCRSA9IGZ1bmN0aW9uIHdyaXRlVUludDMyQkUgKHZhbHVlLCBvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIHZhbHVlID0gK3ZhbHVlXG4gIG9mZnNldCA9IG9mZnNldCB8IDBcbiAgaWYgKCFub0Fzc2VydCkgY2hlY2tJbnQodGhpcywgdmFsdWUsIG9mZnNldCwgNCwgMHhmZmZmZmZmZiwgMClcbiAgaWYgKEJ1ZmZlci5UWVBFRF9BUlJBWV9TVVBQT1JUKSB7XG4gICAgdGhpc1tvZmZzZXRdID0gKHZhbHVlID4+PiAyNClcbiAgICB0aGlzW29mZnNldCArIDFdID0gKHZhbHVlID4+PiAxNilcbiAgICB0aGlzW29mZnNldCArIDJdID0gKHZhbHVlID4+PiA4KVxuICAgIHRoaXNbb2Zmc2V0ICsgM10gPSB2YWx1ZVxuICB9IGVsc2Uge1xuICAgIG9iamVjdFdyaXRlVUludDMyKHRoaXMsIHZhbHVlLCBvZmZzZXQsIGZhbHNlKVxuICB9XG4gIHJldHVybiBvZmZzZXQgKyA0XG59XG5cbkJ1ZmZlci5wcm90b3R5cGUud3JpdGVJbnRMRSA9IGZ1bmN0aW9uIHdyaXRlSW50TEUgKHZhbHVlLCBvZmZzZXQsIGJ5dGVMZW5ndGgsIG5vQXNzZXJ0KSB7XG4gIHZhbHVlID0gK3ZhbHVlXG4gIG9mZnNldCA9IG9mZnNldCB8IDBcbiAgaWYgKCFub0Fzc2VydCkge1xuICAgIHZhciBsaW1pdCA9IE1hdGgucG93KDIsIDggKiBieXRlTGVuZ3RoIC0gMSlcblxuICAgIGNoZWNrSW50KHRoaXMsIHZhbHVlLCBvZmZzZXQsIGJ5dGVMZW5ndGgsIGxpbWl0IC0gMSwgLWxpbWl0KVxuICB9XG5cbiAgdmFyIGkgPSAwXG4gIHZhciBtdWwgPSAxXG4gIHZhciBzdWIgPSB2YWx1ZSA8IDAgPyAxIDogMFxuICB0aGlzW29mZnNldF0gPSB2YWx1ZSAmIDB4RkZcbiAgd2hpbGUgKCsraSA8IGJ5dGVMZW5ndGggJiYgKG11bCAqPSAweDEwMCkpIHtcbiAgICB0aGlzW29mZnNldCArIGldID0gKCh2YWx1ZSAvIG11bCkgPj4gMCkgLSBzdWIgJiAweEZGXG4gIH1cblxuICByZXR1cm4gb2Zmc2V0ICsgYnl0ZUxlbmd0aFxufVxuXG5CdWZmZXIucHJvdG90eXBlLndyaXRlSW50QkUgPSBmdW5jdGlvbiB3cml0ZUludEJFICh2YWx1ZSwgb2Zmc2V0LCBieXRlTGVuZ3RoLCBub0Fzc2VydCkge1xuICB2YWx1ZSA9ICt2YWx1ZVxuICBvZmZzZXQgPSBvZmZzZXQgfCAwXG4gIGlmICghbm9Bc3NlcnQpIHtcbiAgICB2YXIgbGltaXQgPSBNYXRoLnBvdygyLCA4ICogYnl0ZUxlbmd0aCAtIDEpXG5cbiAgICBjaGVja0ludCh0aGlzLCB2YWx1ZSwgb2Zmc2V0LCBieXRlTGVuZ3RoLCBsaW1pdCAtIDEsIC1saW1pdClcbiAgfVxuXG4gIHZhciBpID0gYnl0ZUxlbmd0aCAtIDFcbiAgdmFyIG11bCA9IDFcbiAgdmFyIHN1YiA9IHZhbHVlIDwgMCA/IDEgOiAwXG4gIHRoaXNbb2Zmc2V0ICsgaV0gPSB2YWx1ZSAmIDB4RkZcbiAgd2hpbGUgKC0taSA+PSAwICYmIChtdWwgKj0gMHgxMDApKSB7XG4gICAgdGhpc1tvZmZzZXQgKyBpXSA9ICgodmFsdWUgLyBtdWwpID4+IDApIC0gc3ViICYgMHhGRlxuICB9XG5cbiAgcmV0dXJuIG9mZnNldCArIGJ5dGVMZW5ndGhcbn1cblxuQnVmZmVyLnByb3RvdHlwZS53cml0ZUludDggPSBmdW5jdGlvbiB3cml0ZUludDggKHZhbHVlLCBvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIHZhbHVlID0gK3ZhbHVlXG4gIG9mZnNldCA9IG9mZnNldCB8IDBcbiAgaWYgKCFub0Fzc2VydCkgY2hlY2tJbnQodGhpcywgdmFsdWUsIG9mZnNldCwgMSwgMHg3ZiwgLTB4ODApXG4gIGlmICghQnVmZmVyLlRZUEVEX0FSUkFZX1NVUFBPUlQpIHZhbHVlID0gTWF0aC5mbG9vcih2YWx1ZSlcbiAgaWYgKHZhbHVlIDwgMCkgdmFsdWUgPSAweGZmICsgdmFsdWUgKyAxXG4gIHRoaXNbb2Zmc2V0XSA9IHZhbHVlXG4gIHJldHVybiBvZmZzZXQgKyAxXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUud3JpdGVJbnQxNkxFID0gZnVuY3Rpb24gd3JpdGVJbnQxNkxFICh2YWx1ZSwgb2Zmc2V0LCBub0Fzc2VydCkge1xuICB2YWx1ZSA9ICt2YWx1ZVxuICBvZmZzZXQgPSBvZmZzZXQgfCAwXG4gIGlmICghbm9Bc3NlcnQpIGNoZWNrSW50KHRoaXMsIHZhbHVlLCBvZmZzZXQsIDIsIDB4N2ZmZiwgLTB4ODAwMClcbiAgaWYgKEJ1ZmZlci5UWVBFRF9BUlJBWV9TVVBQT1JUKSB7XG4gICAgdGhpc1tvZmZzZXRdID0gdmFsdWVcbiAgICB0aGlzW29mZnNldCArIDFdID0gKHZhbHVlID4+PiA4KVxuICB9IGVsc2Uge1xuICAgIG9iamVjdFdyaXRlVUludDE2KHRoaXMsIHZhbHVlLCBvZmZzZXQsIHRydWUpXG4gIH1cbiAgcmV0dXJuIG9mZnNldCArIDJcbn1cblxuQnVmZmVyLnByb3RvdHlwZS53cml0ZUludDE2QkUgPSBmdW5jdGlvbiB3cml0ZUludDE2QkUgKHZhbHVlLCBvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIHZhbHVlID0gK3ZhbHVlXG4gIG9mZnNldCA9IG9mZnNldCB8IDBcbiAgaWYgKCFub0Fzc2VydCkgY2hlY2tJbnQodGhpcywgdmFsdWUsIG9mZnNldCwgMiwgMHg3ZmZmLCAtMHg4MDAwKVxuICBpZiAoQnVmZmVyLlRZUEVEX0FSUkFZX1NVUFBPUlQpIHtcbiAgICB0aGlzW29mZnNldF0gPSAodmFsdWUgPj4+IDgpXG4gICAgdGhpc1tvZmZzZXQgKyAxXSA9IHZhbHVlXG4gIH0gZWxzZSB7XG4gICAgb2JqZWN0V3JpdGVVSW50MTYodGhpcywgdmFsdWUsIG9mZnNldCwgZmFsc2UpXG4gIH1cbiAgcmV0dXJuIG9mZnNldCArIDJcbn1cblxuQnVmZmVyLnByb3RvdHlwZS53cml0ZUludDMyTEUgPSBmdW5jdGlvbiB3cml0ZUludDMyTEUgKHZhbHVlLCBvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIHZhbHVlID0gK3ZhbHVlXG4gIG9mZnNldCA9IG9mZnNldCB8IDBcbiAgaWYgKCFub0Fzc2VydCkgY2hlY2tJbnQodGhpcywgdmFsdWUsIG9mZnNldCwgNCwgMHg3ZmZmZmZmZiwgLTB4ODAwMDAwMDApXG4gIGlmIChCdWZmZXIuVFlQRURfQVJSQVlfU1VQUE9SVCkge1xuICAgIHRoaXNbb2Zmc2V0XSA9IHZhbHVlXG4gICAgdGhpc1tvZmZzZXQgKyAxXSA9ICh2YWx1ZSA+Pj4gOClcbiAgICB0aGlzW29mZnNldCArIDJdID0gKHZhbHVlID4+PiAxNilcbiAgICB0aGlzW29mZnNldCArIDNdID0gKHZhbHVlID4+PiAyNClcbiAgfSBlbHNlIHtcbiAgICBvYmplY3RXcml0ZVVJbnQzMih0aGlzLCB2YWx1ZSwgb2Zmc2V0LCB0cnVlKVxuICB9XG4gIHJldHVybiBvZmZzZXQgKyA0XG59XG5cbkJ1ZmZlci5wcm90b3R5cGUud3JpdGVJbnQzMkJFID0gZnVuY3Rpb24gd3JpdGVJbnQzMkJFICh2YWx1ZSwgb2Zmc2V0LCBub0Fzc2VydCkge1xuICB2YWx1ZSA9ICt2YWx1ZVxuICBvZmZzZXQgPSBvZmZzZXQgfCAwXG4gIGlmICghbm9Bc3NlcnQpIGNoZWNrSW50KHRoaXMsIHZhbHVlLCBvZmZzZXQsIDQsIDB4N2ZmZmZmZmYsIC0weDgwMDAwMDAwKVxuICBpZiAodmFsdWUgPCAwKSB2YWx1ZSA9IDB4ZmZmZmZmZmYgKyB2YWx1ZSArIDFcbiAgaWYgKEJ1ZmZlci5UWVBFRF9BUlJBWV9TVVBQT1JUKSB7XG4gICAgdGhpc1tvZmZzZXRdID0gKHZhbHVlID4+PiAyNClcbiAgICB0aGlzW29mZnNldCArIDFdID0gKHZhbHVlID4+PiAxNilcbiAgICB0aGlzW29mZnNldCArIDJdID0gKHZhbHVlID4+PiA4KVxuICAgIHRoaXNbb2Zmc2V0ICsgM10gPSB2YWx1ZVxuICB9IGVsc2Uge1xuICAgIG9iamVjdFdyaXRlVUludDMyKHRoaXMsIHZhbHVlLCBvZmZzZXQsIGZhbHNlKVxuICB9XG4gIHJldHVybiBvZmZzZXQgKyA0XG59XG5cbmZ1bmN0aW9uIGNoZWNrSUVFRTc1NCAoYnVmLCB2YWx1ZSwgb2Zmc2V0LCBleHQsIG1heCwgbWluKSB7XG4gIGlmICh2YWx1ZSA+IG1heCB8fCB2YWx1ZSA8IG1pbikgdGhyb3cgbmV3IFJhbmdlRXJyb3IoJ3ZhbHVlIGlzIG91dCBvZiBib3VuZHMnKVxuICBpZiAob2Zmc2V0ICsgZXh0ID4gYnVmLmxlbmd0aCkgdGhyb3cgbmV3IFJhbmdlRXJyb3IoJ2luZGV4IG91dCBvZiByYW5nZScpXG4gIGlmIChvZmZzZXQgPCAwKSB0aHJvdyBuZXcgUmFuZ2VFcnJvcignaW5kZXggb3V0IG9mIHJhbmdlJylcbn1cblxuZnVuY3Rpb24gd3JpdGVGbG9hdCAoYnVmLCB2YWx1ZSwgb2Zmc2V0LCBsaXR0bGVFbmRpYW4sIG5vQXNzZXJ0KSB7XG4gIGlmICghbm9Bc3NlcnQpIHtcbiAgICBjaGVja0lFRUU3NTQoYnVmLCB2YWx1ZSwgb2Zmc2V0LCA0LCAzLjQwMjgyMzQ2NjM4NTI4ODZlKzM4LCAtMy40MDI4MjM0NjYzODUyODg2ZSszOClcbiAgfVxuICBpZWVlNzU0LndyaXRlKGJ1ZiwgdmFsdWUsIG9mZnNldCwgbGl0dGxlRW5kaWFuLCAyMywgNClcbiAgcmV0dXJuIG9mZnNldCArIDRcbn1cblxuQnVmZmVyLnByb3RvdHlwZS53cml0ZUZsb2F0TEUgPSBmdW5jdGlvbiB3cml0ZUZsb2F0TEUgKHZhbHVlLCBvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIHJldHVybiB3cml0ZUZsb2F0KHRoaXMsIHZhbHVlLCBvZmZzZXQsIHRydWUsIG5vQXNzZXJ0KVxufVxuXG5CdWZmZXIucHJvdG90eXBlLndyaXRlRmxvYXRCRSA9IGZ1bmN0aW9uIHdyaXRlRmxvYXRCRSAodmFsdWUsIG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgcmV0dXJuIHdyaXRlRmxvYXQodGhpcywgdmFsdWUsIG9mZnNldCwgZmFsc2UsIG5vQXNzZXJ0KVxufVxuXG5mdW5jdGlvbiB3cml0ZURvdWJsZSAoYnVmLCB2YWx1ZSwgb2Zmc2V0LCBsaXR0bGVFbmRpYW4sIG5vQXNzZXJ0KSB7XG4gIGlmICghbm9Bc3NlcnQpIHtcbiAgICBjaGVja0lFRUU3NTQoYnVmLCB2YWx1ZSwgb2Zmc2V0LCA4LCAxLjc5NzY5MzEzNDg2MjMxNTdFKzMwOCwgLTEuNzk3NjkzMTM0ODYyMzE1N0UrMzA4KVxuICB9XG4gIGllZWU3NTQud3JpdGUoYnVmLCB2YWx1ZSwgb2Zmc2V0LCBsaXR0bGVFbmRpYW4sIDUyLCA4KVxuICByZXR1cm4gb2Zmc2V0ICsgOFxufVxuXG5CdWZmZXIucHJvdG90eXBlLndyaXRlRG91YmxlTEUgPSBmdW5jdGlvbiB3cml0ZURvdWJsZUxFICh2YWx1ZSwgb2Zmc2V0LCBub0Fzc2VydCkge1xuICByZXR1cm4gd3JpdGVEb3VibGUodGhpcywgdmFsdWUsIG9mZnNldCwgdHJ1ZSwgbm9Bc3NlcnQpXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUud3JpdGVEb3VibGVCRSA9IGZ1bmN0aW9uIHdyaXRlRG91YmxlQkUgKHZhbHVlLCBvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIHJldHVybiB3cml0ZURvdWJsZSh0aGlzLCB2YWx1ZSwgb2Zmc2V0LCBmYWxzZSwgbm9Bc3NlcnQpXG59XG5cbi8vIGNvcHkodGFyZ2V0QnVmZmVyLCB0YXJnZXRTdGFydD0wLCBzb3VyY2VTdGFydD0wLCBzb3VyY2VFbmQ9YnVmZmVyLmxlbmd0aClcbkJ1ZmZlci5wcm90b3R5cGUuY29weSA9IGZ1bmN0aW9uIGNvcHkgKHRhcmdldCwgdGFyZ2V0U3RhcnQsIHN0YXJ0LCBlbmQpIHtcbiAgaWYgKCFzdGFydCkgc3RhcnQgPSAwXG4gIGlmICghZW5kICYmIGVuZCAhPT0gMCkgZW5kID0gdGhpcy5sZW5ndGhcbiAgaWYgKHRhcmdldFN0YXJ0ID49IHRhcmdldC5sZW5ndGgpIHRhcmdldFN0YXJ0ID0gdGFyZ2V0Lmxlbmd0aFxuICBpZiAoIXRhcmdldFN0YXJ0KSB0YXJnZXRTdGFydCA9IDBcbiAgaWYgKGVuZCA+IDAgJiYgZW5kIDwgc3RhcnQpIGVuZCA9IHN0YXJ0XG5cbiAgLy8gQ29weSAwIGJ5dGVzOyB3ZSdyZSBkb25lXG4gIGlmIChlbmQgPT09IHN0YXJ0KSByZXR1cm4gMFxuICBpZiAodGFyZ2V0Lmxlbmd0aCA9PT0gMCB8fCB0aGlzLmxlbmd0aCA9PT0gMCkgcmV0dXJuIDBcblxuICAvLyBGYXRhbCBlcnJvciBjb25kaXRpb25zXG4gIGlmICh0YXJnZXRTdGFydCA8IDApIHtcbiAgICB0aHJvdyBuZXcgUmFuZ2VFcnJvcigndGFyZ2V0U3RhcnQgb3V0IG9mIGJvdW5kcycpXG4gIH1cbiAgaWYgKHN0YXJ0IDwgMCB8fCBzdGFydCA+PSB0aGlzLmxlbmd0aCkgdGhyb3cgbmV3IFJhbmdlRXJyb3IoJ3NvdXJjZVN0YXJ0IG91dCBvZiBib3VuZHMnKVxuICBpZiAoZW5kIDwgMCkgdGhyb3cgbmV3IFJhbmdlRXJyb3IoJ3NvdXJjZUVuZCBvdXQgb2YgYm91bmRzJylcblxuICAvLyBBcmUgd2Ugb29iP1xuICBpZiAoZW5kID4gdGhpcy5sZW5ndGgpIGVuZCA9IHRoaXMubGVuZ3RoXG4gIGlmICh0YXJnZXQubGVuZ3RoIC0gdGFyZ2V0U3RhcnQgPCBlbmQgLSBzdGFydCkge1xuICAgIGVuZCA9IHRhcmdldC5sZW5ndGggLSB0YXJnZXRTdGFydCArIHN0YXJ0XG4gIH1cblxuICB2YXIgbGVuID0gZW5kIC0gc3RhcnRcbiAgdmFyIGlcblxuICBpZiAodGhpcyA9PT0gdGFyZ2V0ICYmIHN0YXJ0IDwgdGFyZ2V0U3RhcnQgJiYgdGFyZ2V0U3RhcnQgPCBlbmQpIHtcbiAgICAvLyBkZXNjZW5kaW5nIGNvcHkgZnJvbSBlbmRcbiAgICBmb3IgKGkgPSBsZW4gLSAxOyBpID49IDA7IGktLSkge1xuICAgICAgdGFyZ2V0W2kgKyB0YXJnZXRTdGFydF0gPSB0aGlzW2kgKyBzdGFydF1cbiAgICB9XG4gIH0gZWxzZSBpZiAobGVuIDwgMTAwMCB8fCAhQnVmZmVyLlRZUEVEX0FSUkFZX1NVUFBPUlQpIHtcbiAgICAvLyBhc2NlbmRpbmcgY29weSBmcm9tIHN0YXJ0XG4gICAgZm9yIChpID0gMDsgaSA8IGxlbjsgaSsrKSB7XG4gICAgICB0YXJnZXRbaSArIHRhcmdldFN0YXJ0XSA9IHRoaXNbaSArIHN0YXJ0XVxuICAgIH1cbiAgfSBlbHNlIHtcbiAgICB0YXJnZXQuX3NldCh0aGlzLnN1YmFycmF5KHN0YXJ0LCBzdGFydCArIGxlbiksIHRhcmdldFN0YXJ0KVxuICB9XG5cbiAgcmV0dXJuIGxlblxufVxuXG4vLyBmaWxsKHZhbHVlLCBzdGFydD0wLCBlbmQ9YnVmZmVyLmxlbmd0aClcbkJ1ZmZlci5wcm90b3R5cGUuZmlsbCA9IGZ1bmN0aW9uIGZpbGwgKHZhbHVlLCBzdGFydCwgZW5kKSB7XG4gIGlmICghdmFsdWUpIHZhbHVlID0gMFxuICBpZiAoIXN0YXJ0KSBzdGFydCA9IDBcbiAgaWYgKCFlbmQpIGVuZCA9IHRoaXMubGVuZ3RoXG5cbiAgaWYgKGVuZCA8IHN0YXJ0KSB0aHJvdyBuZXcgUmFuZ2VFcnJvcignZW5kIDwgc3RhcnQnKVxuXG4gIC8vIEZpbGwgMCBieXRlczsgd2UncmUgZG9uZVxuICBpZiAoZW5kID09PSBzdGFydCkgcmV0dXJuXG4gIGlmICh0aGlzLmxlbmd0aCA9PT0gMCkgcmV0dXJuXG5cbiAgaWYgKHN0YXJ0IDwgMCB8fCBzdGFydCA+PSB0aGlzLmxlbmd0aCkgdGhyb3cgbmV3IFJhbmdlRXJyb3IoJ3N0YXJ0IG91dCBvZiBib3VuZHMnKVxuICBpZiAoZW5kIDwgMCB8fCBlbmQgPiB0aGlzLmxlbmd0aCkgdGhyb3cgbmV3IFJhbmdlRXJyb3IoJ2VuZCBvdXQgb2YgYm91bmRzJylcblxuICB2YXIgaVxuICBpZiAodHlwZW9mIHZhbHVlID09PSAnbnVtYmVyJykge1xuICAgIGZvciAoaSA9IHN0YXJ0OyBpIDwgZW5kOyBpKyspIHtcbiAgICAgIHRoaXNbaV0gPSB2YWx1ZVxuICAgIH1cbiAgfSBlbHNlIHtcbiAgICB2YXIgYnl0ZXMgPSB1dGY4VG9CeXRlcyh2YWx1ZS50b1N0cmluZygpKVxuICAgIHZhciBsZW4gPSBieXRlcy5sZW5ndGhcbiAgICBmb3IgKGkgPSBzdGFydDsgaSA8IGVuZDsgaSsrKSB7XG4gICAgICB0aGlzW2ldID0gYnl0ZXNbaSAlIGxlbl1cbiAgICB9XG4gIH1cblxuICByZXR1cm4gdGhpc1xufVxuXG4vKipcbiAqIENyZWF0ZXMgYSBuZXcgYEFycmF5QnVmZmVyYCB3aXRoIHRoZSAqY29waWVkKiBtZW1vcnkgb2YgdGhlIGJ1ZmZlciBpbnN0YW5jZS5cbiAqIEFkZGVkIGluIE5vZGUgMC4xMi4gT25seSBhdmFpbGFibGUgaW4gYnJvd3NlcnMgdGhhdCBzdXBwb3J0IEFycmF5QnVmZmVyLlxuICovXG5CdWZmZXIucHJvdG90eXBlLnRvQXJyYXlCdWZmZXIgPSBmdW5jdGlvbiB0b0FycmF5QnVmZmVyICgpIHtcbiAgaWYgKHR5cGVvZiBVaW50OEFycmF5ICE9PSAndW5kZWZpbmVkJykge1xuICAgIGlmIChCdWZmZXIuVFlQRURfQVJSQVlfU1VQUE9SVCkge1xuICAgICAgcmV0dXJuIChuZXcgQnVmZmVyKHRoaXMpKS5idWZmZXJcbiAgICB9IGVsc2Uge1xuICAgICAgdmFyIGJ1ZiA9IG5ldyBVaW50OEFycmF5KHRoaXMubGVuZ3RoKVxuICAgICAgZm9yICh2YXIgaSA9IDAsIGxlbiA9IGJ1Zi5sZW5ndGg7IGkgPCBsZW47IGkgKz0gMSkge1xuICAgICAgICBidWZbaV0gPSB0aGlzW2ldXG4gICAgICB9XG4gICAgICByZXR1cm4gYnVmLmJ1ZmZlclxuICAgIH1cbiAgfSBlbHNlIHtcbiAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdCdWZmZXIudG9BcnJheUJ1ZmZlciBub3Qgc3VwcG9ydGVkIGluIHRoaXMgYnJvd3NlcicpXG4gIH1cbn1cblxuLy8gSEVMUEVSIEZVTkNUSU9OU1xuLy8gPT09PT09PT09PT09PT09PVxuXG52YXIgQlAgPSBCdWZmZXIucHJvdG90eXBlXG5cbi8qKlxuICogQXVnbWVudCBhIFVpbnQ4QXJyYXkgKmluc3RhbmNlKiAobm90IHRoZSBVaW50OEFycmF5IGNsYXNzISkgd2l0aCBCdWZmZXIgbWV0aG9kc1xuICovXG5CdWZmZXIuX2F1Z21lbnQgPSBmdW5jdGlvbiBfYXVnbWVudCAoYXJyKSB7XG4gIGFyci5jb25zdHJ1Y3RvciA9IEJ1ZmZlclxuICBhcnIuX2lzQnVmZmVyID0gdHJ1ZVxuXG4gIC8vIHNhdmUgcmVmZXJlbmNlIHRvIG9yaWdpbmFsIFVpbnQ4QXJyYXkgc2V0IG1ldGhvZCBiZWZvcmUgb3ZlcndyaXRpbmdcbiAgYXJyLl9zZXQgPSBhcnIuc2V0XG5cbiAgLy8gZGVwcmVjYXRlZFxuICBhcnIuZ2V0ID0gQlAuZ2V0XG4gIGFyci5zZXQgPSBCUC5zZXRcblxuICBhcnIud3JpdGUgPSBCUC53cml0ZVxuICBhcnIudG9TdHJpbmcgPSBCUC50b1N0cmluZ1xuICBhcnIudG9Mb2NhbGVTdHJpbmcgPSBCUC50b1N0cmluZ1xuICBhcnIudG9KU09OID0gQlAudG9KU09OXG4gIGFyci5lcXVhbHMgPSBCUC5lcXVhbHNcbiAgYXJyLmNvbXBhcmUgPSBCUC5jb21wYXJlXG4gIGFyci5pbmRleE9mID0gQlAuaW5kZXhPZlxuICBhcnIuY29weSA9IEJQLmNvcHlcbiAgYXJyLnNsaWNlID0gQlAuc2xpY2VcbiAgYXJyLnJlYWRVSW50TEUgPSBCUC5yZWFkVUludExFXG4gIGFyci5yZWFkVUludEJFID0gQlAucmVhZFVJbnRCRVxuICBhcnIucmVhZFVJbnQ4ID0gQlAucmVhZFVJbnQ4XG4gIGFyci5yZWFkVUludDE2TEUgPSBCUC5yZWFkVUludDE2TEVcbiAgYXJyLnJlYWRVSW50MTZCRSA9IEJQLnJlYWRVSW50MTZCRVxuICBhcnIucmVhZFVJbnQzMkxFID0gQlAucmVhZFVJbnQzMkxFXG4gIGFyci5yZWFkVUludDMyQkUgPSBCUC5yZWFkVUludDMyQkVcbiAgYXJyLnJlYWRJbnRMRSA9IEJQLnJlYWRJbnRMRVxuICBhcnIucmVhZEludEJFID0gQlAucmVhZEludEJFXG4gIGFyci5yZWFkSW50OCA9IEJQLnJlYWRJbnQ4XG4gIGFyci5yZWFkSW50MTZMRSA9IEJQLnJlYWRJbnQxNkxFXG4gIGFyci5yZWFkSW50MTZCRSA9IEJQLnJlYWRJbnQxNkJFXG4gIGFyci5yZWFkSW50MzJMRSA9IEJQLnJlYWRJbnQzMkxFXG4gIGFyci5yZWFkSW50MzJCRSA9IEJQLnJlYWRJbnQzMkJFXG4gIGFyci5yZWFkRmxvYXRMRSA9IEJQLnJlYWRGbG9hdExFXG4gIGFyci5yZWFkRmxvYXRCRSA9IEJQLnJlYWRGbG9hdEJFXG4gIGFyci5yZWFkRG91YmxlTEUgPSBCUC5yZWFkRG91YmxlTEVcbiAgYXJyLnJlYWREb3VibGVCRSA9IEJQLnJlYWREb3VibGVCRVxuICBhcnIud3JpdGVVSW50OCA9IEJQLndyaXRlVUludDhcbiAgYXJyLndyaXRlVUludExFID0gQlAud3JpdGVVSW50TEVcbiAgYXJyLndyaXRlVUludEJFID0gQlAud3JpdGVVSW50QkVcbiAgYXJyLndyaXRlVUludDE2TEUgPSBCUC53cml0ZVVJbnQxNkxFXG4gIGFyci53cml0ZVVJbnQxNkJFID0gQlAud3JpdGVVSW50MTZCRVxuICBhcnIud3JpdGVVSW50MzJMRSA9IEJQLndyaXRlVUludDMyTEVcbiAgYXJyLndyaXRlVUludDMyQkUgPSBCUC53cml0ZVVJbnQzMkJFXG4gIGFyci53cml0ZUludExFID0gQlAud3JpdGVJbnRMRVxuICBhcnIud3JpdGVJbnRCRSA9IEJQLndyaXRlSW50QkVcbiAgYXJyLndyaXRlSW50OCA9IEJQLndyaXRlSW50OFxuICBhcnIud3JpdGVJbnQxNkxFID0gQlAud3JpdGVJbnQxNkxFXG4gIGFyci53cml0ZUludDE2QkUgPSBCUC53cml0ZUludDE2QkVcbiAgYXJyLndyaXRlSW50MzJMRSA9IEJQLndyaXRlSW50MzJMRVxuICBhcnIud3JpdGVJbnQzMkJFID0gQlAud3JpdGVJbnQzMkJFXG4gIGFyci53cml0ZUZsb2F0TEUgPSBCUC53cml0ZUZsb2F0TEVcbiAgYXJyLndyaXRlRmxvYXRCRSA9IEJQLndyaXRlRmxvYXRCRVxuICBhcnIud3JpdGVEb3VibGVMRSA9IEJQLndyaXRlRG91YmxlTEVcbiAgYXJyLndyaXRlRG91YmxlQkUgPSBCUC53cml0ZURvdWJsZUJFXG4gIGFyci5maWxsID0gQlAuZmlsbFxuICBhcnIuaW5zcGVjdCA9IEJQLmluc3BlY3RcbiAgYXJyLnRvQXJyYXlCdWZmZXIgPSBCUC50b0FycmF5QnVmZmVyXG5cbiAgcmV0dXJuIGFyclxufVxuXG52YXIgSU5WQUxJRF9CQVNFNjRfUkUgPSAvW14rXFwvMC05QS1aYS16LV9dL2dcblxuZnVuY3Rpb24gYmFzZTY0Y2xlYW4gKHN0cikge1xuICAvLyBOb2RlIHN0cmlwcyBvdXQgaW52YWxpZCBjaGFyYWN0ZXJzIGxpa2UgXFxuIGFuZCBcXHQgZnJvbSB0aGUgc3RyaW5nLCBiYXNlNjQtanMgZG9lcyBub3RcbiAgc3RyID0gc3RyaW5ndHJpbShzdHIpLnJlcGxhY2UoSU5WQUxJRF9CQVNFNjRfUkUsICcnKVxuICAvLyBOb2RlIGNvbnZlcnRzIHN0cmluZ3Mgd2l0aCBsZW5ndGggPCAyIHRvICcnXG4gIGlmIChzdHIubGVuZ3RoIDwgMikgcmV0dXJuICcnXG4gIC8vIE5vZGUgYWxsb3dzIGZvciBub24tcGFkZGVkIGJhc2U2NCBzdHJpbmdzIChtaXNzaW5nIHRyYWlsaW5nID09PSksIGJhc2U2NC1qcyBkb2VzIG5vdFxuICB3aGlsZSAoc3RyLmxlbmd0aCAlIDQgIT09IDApIHtcbiAgICBzdHIgPSBzdHIgKyAnPSdcbiAgfVxuICByZXR1cm4gc3RyXG59XG5cbmZ1bmN0aW9uIHN0cmluZ3RyaW0gKHN0cikge1xuICBpZiAoc3RyLnRyaW0pIHJldHVybiBzdHIudHJpbSgpXG4gIHJldHVybiBzdHIucmVwbGFjZSgvXlxccyt8XFxzKyQvZywgJycpXG59XG5cbmZ1bmN0aW9uIHRvSGV4IChuKSB7XG4gIGlmIChuIDwgMTYpIHJldHVybiAnMCcgKyBuLnRvU3RyaW5nKDE2KVxuICByZXR1cm4gbi50b1N0cmluZygxNilcbn1cblxuZnVuY3Rpb24gdXRmOFRvQnl0ZXMgKHN0cmluZywgdW5pdHMpIHtcbiAgdW5pdHMgPSB1bml0cyB8fCBJbmZpbml0eVxuICB2YXIgY29kZVBvaW50XG4gIHZhciBsZW5ndGggPSBzdHJpbmcubGVuZ3RoXG4gIHZhciBsZWFkU3Vycm9nYXRlID0gbnVsbFxuICB2YXIgYnl0ZXMgPSBbXVxuXG4gIGZvciAodmFyIGkgPSAwOyBpIDwgbGVuZ3RoOyBpKyspIHtcbiAgICBjb2RlUG9pbnQgPSBzdHJpbmcuY2hhckNvZGVBdChpKVxuXG4gICAgLy8gaXMgc3Vycm9nYXRlIGNvbXBvbmVudFxuICAgIGlmIChjb2RlUG9pbnQgPiAweEQ3RkYgJiYgY29kZVBvaW50IDwgMHhFMDAwKSB7XG4gICAgICAvLyBsYXN0IGNoYXIgd2FzIGEgbGVhZFxuICAgICAgaWYgKCFsZWFkU3Vycm9nYXRlKSB7XG4gICAgICAgIC8vIG5vIGxlYWQgeWV0XG4gICAgICAgIGlmIChjb2RlUG9pbnQgPiAweERCRkYpIHtcbiAgICAgICAgICAvLyB1bmV4cGVjdGVkIHRyYWlsXG4gICAgICAgICAgaWYgKCh1bml0cyAtPSAzKSA+IC0xKSBieXRlcy5wdXNoKDB4RUYsIDB4QkYsIDB4QkQpXG4gICAgICAgICAgY29udGludWVcblxuICAgICAgICB9IGVsc2UgaWYgKGkgKyAxID09PSBsZW5ndGgpIHtcbiAgICAgICAgICAvLyB1bnBhaXJlZCBsZWFkXG4gICAgICAgICAgaWYgKCh1bml0cyAtPSAzKSA+IC0xKSBieXRlcy5wdXNoKDB4RUYsIDB4QkYsIDB4QkQpXG4gICAgICAgICAgY29udGludWVcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIHZhbGlkIGxlYWRcbiAgICAgICAgbGVhZFN1cnJvZ2F0ZSA9IGNvZGVQb2ludFxuXG4gICAgICAgIGNvbnRpbnVlXG4gICAgICB9XG5cbiAgICAgIC8vIDIgbGVhZHMgaW4gYSByb3dcbiAgICAgIGlmIChjb2RlUG9pbnQgPCAweERDMDApIHtcbiAgICAgICAgaWYgKCh1bml0cyAtPSAzKSA+IC0xKSBieXRlcy5wdXNoKDB4RUYsIDB4QkYsIDB4QkQpXG4gICAgICAgIGxlYWRTdXJyb2dhdGUgPSBjb2RlUG9pbnRcbiAgICAgICAgY29udGludWVcbiAgICAgIH1cblxuICAgICAgLy8gdmFsaWQgc3Vycm9nYXRlIHBhaXJcbiAgICAgIGNvZGVQb2ludCA9IGxlYWRTdXJyb2dhdGUgLSAweEQ4MDAgPDwgMTAgfCBjb2RlUG9pbnQgLSAweERDMDAgfCAweDEwMDAwXG5cbiAgICB9IGVsc2UgaWYgKGxlYWRTdXJyb2dhdGUpIHtcbiAgICAgIC8vIHZhbGlkIGJtcCBjaGFyLCBidXQgbGFzdCBjaGFyIHdhcyBhIGxlYWRcbiAgICAgIGlmICgodW5pdHMgLT0gMykgPiAtMSkgYnl0ZXMucHVzaCgweEVGLCAweEJGLCAweEJEKVxuICAgIH1cblxuICAgIGxlYWRTdXJyb2dhdGUgPSBudWxsXG5cbiAgICAvLyBlbmNvZGUgdXRmOFxuICAgIGlmIChjb2RlUG9pbnQgPCAweDgwKSB7XG4gICAgICBpZiAoKHVuaXRzIC09IDEpIDwgMCkgYnJlYWtcbiAgICAgIGJ5dGVzLnB1c2goY29kZVBvaW50KVxuICAgIH0gZWxzZSBpZiAoY29kZVBvaW50IDwgMHg4MDApIHtcbiAgICAgIGlmICgodW5pdHMgLT0gMikgPCAwKSBicmVha1xuICAgICAgYnl0ZXMucHVzaChcbiAgICAgICAgY29kZVBvaW50ID4+IDB4NiB8IDB4QzAsXG4gICAgICAgIGNvZGVQb2ludCAmIDB4M0YgfCAweDgwXG4gICAgICApXG4gICAgfSBlbHNlIGlmIChjb2RlUG9pbnQgPCAweDEwMDAwKSB7XG4gICAgICBpZiAoKHVuaXRzIC09IDMpIDwgMCkgYnJlYWtcbiAgICAgIGJ5dGVzLnB1c2goXG4gICAgICAgIGNvZGVQb2ludCA+PiAweEMgfCAweEUwLFxuICAgICAgICBjb2RlUG9pbnQgPj4gMHg2ICYgMHgzRiB8IDB4ODAsXG4gICAgICAgIGNvZGVQb2ludCAmIDB4M0YgfCAweDgwXG4gICAgICApXG4gICAgfSBlbHNlIGlmIChjb2RlUG9pbnQgPCAweDExMDAwMCkge1xuICAgICAgaWYgKCh1bml0cyAtPSA0KSA8IDApIGJyZWFrXG4gICAgICBieXRlcy5wdXNoKFxuICAgICAgICBjb2RlUG9pbnQgPj4gMHgxMiB8IDB4RjAsXG4gICAgICAgIGNvZGVQb2ludCA+PiAweEMgJiAweDNGIHwgMHg4MCxcbiAgICAgICAgY29kZVBvaW50ID4+IDB4NiAmIDB4M0YgfCAweDgwLFxuICAgICAgICBjb2RlUG9pbnQgJiAweDNGIHwgMHg4MFxuICAgICAgKVxuICAgIH0gZWxzZSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ0ludmFsaWQgY29kZSBwb2ludCcpXG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIGJ5dGVzXG59XG5cbmZ1bmN0aW9uIGFzY2lpVG9CeXRlcyAoc3RyKSB7XG4gIHZhciBieXRlQXJyYXkgPSBbXVxuICBmb3IgKHZhciBpID0gMDsgaSA8IHN0ci5sZW5ndGg7IGkrKykge1xuICAgIC8vIE5vZGUncyBjb2RlIHNlZW1zIHRvIGJlIGRvaW5nIHRoaXMgYW5kIG5vdCAmIDB4N0YuLlxuICAgIGJ5dGVBcnJheS5wdXNoKHN0ci5jaGFyQ29kZUF0KGkpICYgMHhGRilcbiAgfVxuICByZXR1cm4gYnl0ZUFycmF5XG59XG5cbmZ1bmN0aW9uIHV0ZjE2bGVUb0J5dGVzIChzdHIsIHVuaXRzKSB7XG4gIHZhciBjLCBoaSwgbG9cbiAgdmFyIGJ5dGVBcnJheSA9IFtdXG4gIGZvciAodmFyIGkgPSAwOyBpIDwgc3RyLmxlbmd0aDsgaSsrKSB7XG4gICAgaWYgKCh1bml0cyAtPSAyKSA8IDApIGJyZWFrXG5cbiAgICBjID0gc3RyLmNoYXJDb2RlQXQoaSlcbiAgICBoaSA9IGMgPj4gOFxuICAgIGxvID0gYyAlIDI1NlxuICAgIGJ5dGVBcnJheS5wdXNoKGxvKVxuICAgIGJ5dGVBcnJheS5wdXNoKGhpKVxuICB9XG5cbiAgcmV0dXJuIGJ5dGVBcnJheVxufVxuXG5mdW5jdGlvbiBiYXNlNjRUb0J5dGVzIChzdHIpIHtcbiAgcmV0dXJuIGJhc2U2NC50b0J5dGVBcnJheShiYXNlNjRjbGVhbihzdHIpKVxufVxuXG5mdW5jdGlvbiBibGl0QnVmZmVyIChzcmMsIGRzdCwgb2Zmc2V0LCBsZW5ndGgpIHtcbiAgZm9yICh2YXIgaSA9IDA7IGkgPCBsZW5ndGg7IGkrKykge1xuICAgIGlmICgoaSArIG9mZnNldCA+PSBkc3QubGVuZ3RoKSB8fCAoaSA+PSBzcmMubGVuZ3RoKSkgYnJlYWtcbiAgICBkc3RbaSArIG9mZnNldF0gPSBzcmNbaV1cbiAgfVxuICByZXR1cm4gaVxufVxuIiwidmFyIGxvb2t1cCA9ICdBQkNERUZHSElKS0xNTk9QUVJTVFVWV1hZWmFiY2RlZmdoaWprbG1ub3BxcnN0dXZ3eHl6MDEyMzQ1Njc4OSsvJztcblxuOyhmdW5jdGlvbiAoZXhwb3J0cykge1xuXHQndXNlIHN0cmljdCc7XG5cbiAgdmFyIEFyciA9ICh0eXBlb2YgVWludDhBcnJheSAhPT0gJ3VuZGVmaW5lZCcpXG4gICAgPyBVaW50OEFycmF5XG4gICAgOiBBcnJheVxuXG5cdHZhciBQTFVTICAgPSAnKycuY2hhckNvZGVBdCgwKVxuXHR2YXIgU0xBU0ggID0gJy8nLmNoYXJDb2RlQXQoMClcblx0dmFyIE5VTUJFUiA9ICcwJy5jaGFyQ29kZUF0KDApXG5cdHZhciBMT1dFUiAgPSAnYScuY2hhckNvZGVBdCgwKVxuXHR2YXIgVVBQRVIgID0gJ0EnLmNoYXJDb2RlQXQoMClcblx0dmFyIFBMVVNfVVJMX1NBRkUgPSAnLScuY2hhckNvZGVBdCgwKVxuXHR2YXIgU0xBU0hfVVJMX1NBRkUgPSAnXycuY2hhckNvZGVBdCgwKVxuXG5cdGZ1bmN0aW9uIGRlY29kZSAoZWx0KSB7XG5cdFx0dmFyIGNvZGUgPSBlbHQuY2hhckNvZGVBdCgwKVxuXHRcdGlmIChjb2RlID09PSBQTFVTIHx8XG5cdFx0ICAgIGNvZGUgPT09IFBMVVNfVVJMX1NBRkUpXG5cdFx0XHRyZXR1cm4gNjIgLy8gJysnXG5cdFx0aWYgKGNvZGUgPT09IFNMQVNIIHx8XG5cdFx0ICAgIGNvZGUgPT09IFNMQVNIX1VSTF9TQUZFKVxuXHRcdFx0cmV0dXJuIDYzIC8vICcvJ1xuXHRcdGlmIChjb2RlIDwgTlVNQkVSKVxuXHRcdFx0cmV0dXJuIC0xIC8vbm8gbWF0Y2hcblx0XHRpZiAoY29kZSA8IE5VTUJFUiArIDEwKVxuXHRcdFx0cmV0dXJuIGNvZGUgLSBOVU1CRVIgKyAyNiArIDI2XG5cdFx0aWYgKGNvZGUgPCBVUFBFUiArIDI2KVxuXHRcdFx0cmV0dXJuIGNvZGUgLSBVUFBFUlxuXHRcdGlmIChjb2RlIDwgTE9XRVIgKyAyNilcblx0XHRcdHJldHVybiBjb2RlIC0gTE9XRVIgKyAyNlxuXHR9XG5cblx0ZnVuY3Rpb24gYjY0VG9CeXRlQXJyYXkgKGI2NCkge1xuXHRcdHZhciBpLCBqLCBsLCB0bXAsIHBsYWNlSG9sZGVycywgYXJyXG5cblx0XHRpZiAoYjY0Lmxlbmd0aCAlIDQgPiAwKSB7XG5cdFx0XHR0aHJvdyBuZXcgRXJyb3IoJ0ludmFsaWQgc3RyaW5nLiBMZW5ndGggbXVzdCBiZSBhIG11bHRpcGxlIG9mIDQnKVxuXHRcdH1cblxuXHRcdC8vIHRoZSBudW1iZXIgb2YgZXF1YWwgc2lnbnMgKHBsYWNlIGhvbGRlcnMpXG5cdFx0Ly8gaWYgdGhlcmUgYXJlIHR3byBwbGFjZWhvbGRlcnMsIHRoYW4gdGhlIHR3byBjaGFyYWN0ZXJzIGJlZm9yZSBpdFxuXHRcdC8vIHJlcHJlc2VudCBvbmUgYnl0ZVxuXHRcdC8vIGlmIHRoZXJlIGlzIG9ubHkgb25lLCB0aGVuIHRoZSB0aHJlZSBjaGFyYWN0ZXJzIGJlZm9yZSBpdCByZXByZXNlbnQgMiBieXRlc1xuXHRcdC8vIHRoaXMgaXMganVzdCBhIGNoZWFwIGhhY2sgdG8gbm90IGRvIGluZGV4T2YgdHdpY2Vcblx0XHR2YXIgbGVuID0gYjY0Lmxlbmd0aFxuXHRcdHBsYWNlSG9sZGVycyA9ICc9JyA9PT0gYjY0LmNoYXJBdChsZW4gLSAyKSA/IDIgOiAnPScgPT09IGI2NC5jaGFyQXQobGVuIC0gMSkgPyAxIDogMFxuXG5cdFx0Ly8gYmFzZTY0IGlzIDQvMyArIHVwIHRvIHR3byBjaGFyYWN0ZXJzIG9mIHRoZSBvcmlnaW5hbCBkYXRhXG5cdFx0YXJyID0gbmV3IEFycihiNjQubGVuZ3RoICogMyAvIDQgLSBwbGFjZUhvbGRlcnMpXG5cblx0XHQvLyBpZiB0aGVyZSBhcmUgcGxhY2Vob2xkZXJzLCBvbmx5IGdldCB1cCB0byB0aGUgbGFzdCBjb21wbGV0ZSA0IGNoYXJzXG5cdFx0bCA9IHBsYWNlSG9sZGVycyA+IDAgPyBiNjQubGVuZ3RoIC0gNCA6IGI2NC5sZW5ndGhcblxuXHRcdHZhciBMID0gMFxuXG5cdFx0ZnVuY3Rpb24gcHVzaCAodikge1xuXHRcdFx0YXJyW0wrK10gPSB2XG5cdFx0fVxuXG5cdFx0Zm9yIChpID0gMCwgaiA9IDA7IGkgPCBsOyBpICs9IDQsIGogKz0gMykge1xuXHRcdFx0dG1wID0gKGRlY29kZShiNjQuY2hhckF0KGkpKSA8PCAxOCkgfCAoZGVjb2RlKGI2NC5jaGFyQXQoaSArIDEpKSA8PCAxMikgfCAoZGVjb2RlKGI2NC5jaGFyQXQoaSArIDIpKSA8PCA2KSB8IGRlY29kZShiNjQuY2hhckF0KGkgKyAzKSlcblx0XHRcdHB1c2goKHRtcCAmIDB4RkYwMDAwKSA+PiAxNilcblx0XHRcdHB1c2goKHRtcCAmIDB4RkYwMCkgPj4gOClcblx0XHRcdHB1c2godG1wICYgMHhGRilcblx0XHR9XG5cblx0XHRpZiAocGxhY2VIb2xkZXJzID09PSAyKSB7XG5cdFx0XHR0bXAgPSAoZGVjb2RlKGI2NC5jaGFyQXQoaSkpIDw8IDIpIHwgKGRlY29kZShiNjQuY2hhckF0KGkgKyAxKSkgPj4gNClcblx0XHRcdHB1c2godG1wICYgMHhGRilcblx0XHR9IGVsc2UgaWYgKHBsYWNlSG9sZGVycyA9PT0gMSkge1xuXHRcdFx0dG1wID0gKGRlY29kZShiNjQuY2hhckF0KGkpKSA8PCAxMCkgfCAoZGVjb2RlKGI2NC5jaGFyQXQoaSArIDEpKSA8PCA0KSB8IChkZWNvZGUoYjY0LmNoYXJBdChpICsgMikpID4+IDIpXG5cdFx0XHRwdXNoKCh0bXAgPj4gOCkgJiAweEZGKVxuXHRcdFx0cHVzaCh0bXAgJiAweEZGKVxuXHRcdH1cblxuXHRcdHJldHVybiBhcnJcblx0fVxuXG5cdGZ1bmN0aW9uIHVpbnQ4VG9CYXNlNjQgKHVpbnQ4KSB7XG5cdFx0dmFyIGksXG5cdFx0XHRleHRyYUJ5dGVzID0gdWludDgubGVuZ3RoICUgMywgLy8gaWYgd2UgaGF2ZSAxIGJ5dGUgbGVmdCwgcGFkIDIgYnl0ZXNcblx0XHRcdG91dHB1dCA9IFwiXCIsXG5cdFx0XHR0ZW1wLCBsZW5ndGhcblxuXHRcdGZ1bmN0aW9uIGVuY29kZSAobnVtKSB7XG5cdFx0XHRyZXR1cm4gbG9va3VwLmNoYXJBdChudW0pXG5cdFx0fVxuXG5cdFx0ZnVuY3Rpb24gdHJpcGxldFRvQmFzZTY0IChudW0pIHtcblx0XHRcdHJldHVybiBlbmNvZGUobnVtID4+IDE4ICYgMHgzRikgKyBlbmNvZGUobnVtID4+IDEyICYgMHgzRikgKyBlbmNvZGUobnVtID4+IDYgJiAweDNGKSArIGVuY29kZShudW0gJiAweDNGKVxuXHRcdH1cblxuXHRcdC8vIGdvIHRocm91Z2ggdGhlIGFycmF5IGV2ZXJ5IHRocmVlIGJ5dGVzLCB3ZSdsbCBkZWFsIHdpdGggdHJhaWxpbmcgc3R1ZmYgbGF0ZXJcblx0XHRmb3IgKGkgPSAwLCBsZW5ndGggPSB1aW50OC5sZW5ndGggLSBleHRyYUJ5dGVzOyBpIDwgbGVuZ3RoOyBpICs9IDMpIHtcblx0XHRcdHRlbXAgPSAodWludDhbaV0gPDwgMTYpICsgKHVpbnQ4W2kgKyAxXSA8PCA4KSArICh1aW50OFtpICsgMl0pXG5cdFx0XHRvdXRwdXQgKz0gdHJpcGxldFRvQmFzZTY0KHRlbXApXG5cdFx0fVxuXG5cdFx0Ly8gcGFkIHRoZSBlbmQgd2l0aCB6ZXJvcywgYnV0IG1ha2Ugc3VyZSB0byBub3QgZm9yZ2V0IHRoZSBleHRyYSBieXRlc1xuXHRcdHN3aXRjaCAoZXh0cmFCeXRlcykge1xuXHRcdFx0Y2FzZSAxOlxuXHRcdFx0XHR0ZW1wID0gdWludDhbdWludDgubGVuZ3RoIC0gMV1cblx0XHRcdFx0b3V0cHV0ICs9IGVuY29kZSh0ZW1wID4+IDIpXG5cdFx0XHRcdG91dHB1dCArPSBlbmNvZGUoKHRlbXAgPDwgNCkgJiAweDNGKVxuXHRcdFx0XHRvdXRwdXQgKz0gJz09J1xuXHRcdFx0XHRicmVha1xuXHRcdFx0Y2FzZSAyOlxuXHRcdFx0XHR0ZW1wID0gKHVpbnQ4W3VpbnQ4Lmxlbmd0aCAtIDJdIDw8IDgpICsgKHVpbnQ4W3VpbnQ4Lmxlbmd0aCAtIDFdKVxuXHRcdFx0XHRvdXRwdXQgKz0gZW5jb2RlKHRlbXAgPj4gMTApXG5cdFx0XHRcdG91dHB1dCArPSBlbmNvZGUoKHRlbXAgPj4gNCkgJiAweDNGKVxuXHRcdFx0XHRvdXRwdXQgKz0gZW5jb2RlKCh0ZW1wIDw8IDIpICYgMHgzRilcblx0XHRcdFx0b3V0cHV0ICs9ICc9J1xuXHRcdFx0XHRicmVha1xuXHRcdH1cblxuXHRcdHJldHVybiBvdXRwdXRcblx0fVxuXG5cdGV4cG9ydHMudG9CeXRlQXJyYXkgPSBiNjRUb0J5dGVBcnJheVxuXHRleHBvcnRzLmZyb21CeXRlQXJyYXkgPSB1aW50OFRvQmFzZTY0XG59KHR5cGVvZiBleHBvcnRzID09PSAndW5kZWZpbmVkJyA/ICh0aGlzLmJhc2U2NGpzID0ge30pIDogZXhwb3J0cykpXG4iLCJleHBvcnRzLnJlYWQgPSBmdW5jdGlvbiAoYnVmZmVyLCBvZmZzZXQsIGlzTEUsIG1MZW4sIG5CeXRlcykge1xuICB2YXIgZSwgbVxuICB2YXIgZUxlbiA9IG5CeXRlcyAqIDggLSBtTGVuIC0gMVxuICB2YXIgZU1heCA9ICgxIDw8IGVMZW4pIC0gMVxuICB2YXIgZUJpYXMgPSBlTWF4ID4+IDFcbiAgdmFyIG5CaXRzID0gLTdcbiAgdmFyIGkgPSBpc0xFID8gKG5CeXRlcyAtIDEpIDogMFxuICB2YXIgZCA9IGlzTEUgPyAtMSA6IDFcbiAgdmFyIHMgPSBidWZmZXJbb2Zmc2V0ICsgaV1cblxuICBpICs9IGRcblxuICBlID0gcyAmICgoMSA8PCAoLW5CaXRzKSkgLSAxKVxuICBzID4+PSAoLW5CaXRzKVxuICBuQml0cyArPSBlTGVuXG4gIGZvciAoOyBuQml0cyA+IDA7IGUgPSBlICogMjU2ICsgYnVmZmVyW29mZnNldCArIGldLCBpICs9IGQsIG5CaXRzIC09IDgpIHt9XG5cbiAgbSA9IGUgJiAoKDEgPDwgKC1uQml0cykpIC0gMSlcbiAgZSA+Pj0gKC1uQml0cylcbiAgbkJpdHMgKz0gbUxlblxuICBmb3IgKDsgbkJpdHMgPiAwOyBtID0gbSAqIDI1NiArIGJ1ZmZlcltvZmZzZXQgKyBpXSwgaSArPSBkLCBuQml0cyAtPSA4KSB7fVxuXG4gIGlmIChlID09PSAwKSB7XG4gICAgZSA9IDEgLSBlQmlhc1xuICB9IGVsc2UgaWYgKGUgPT09IGVNYXgpIHtcbiAgICByZXR1cm4gbSA/IE5hTiA6ICgocyA/IC0xIDogMSkgKiBJbmZpbml0eSlcbiAgfSBlbHNlIHtcbiAgICBtID0gbSArIE1hdGgucG93KDIsIG1MZW4pXG4gICAgZSA9IGUgLSBlQmlhc1xuICB9XG4gIHJldHVybiAocyA/IC0xIDogMSkgKiBtICogTWF0aC5wb3coMiwgZSAtIG1MZW4pXG59XG5cbmV4cG9ydHMud3JpdGUgPSBmdW5jdGlvbiAoYnVmZmVyLCB2YWx1ZSwgb2Zmc2V0LCBpc0xFLCBtTGVuLCBuQnl0ZXMpIHtcbiAgdmFyIGUsIG0sIGNcbiAgdmFyIGVMZW4gPSBuQnl0ZXMgKiA4IC0gbUxlbiAtIDFcbiAgdmFyIGVNYXggPSAoMSA8PCBlTGVuKSAtIDFcbiAgdmFyIGVCaWFzID0gZU1heCA+PiAxXG4gIHZhciBydCA9IChtTGVuID09PSAyMyA/IE1hdGgucG93KDIsIC0yNCkgLSBNYXRoLnBvdygyLCAtNzcpIDogMClcbiAgdmFyIGkgPSBpc0xFID8gMCA6IChuQnl0ZXMgLSAxKVxuICB2YXIgZCA9IGlzTEUgPyAxIDogLTFcbiAgdmFyIHMgPSB2YWx1ZSA8IDAgfHwgKHZhbHVlID09PSAwICYmIDEgLyB2YWx1ZSA8IDApID8gMSA6IDBcblxuICB2YWx1ZSA9IE1hdGguYWJzKHZhbHVlKVxuXG4gIGlmIChpc05hTih2YWx1ZSkgfHwgdmFsdWUgPT09IEluZmluaXR5KSB7XG4gICAgbSA9IGlzTmFOKHZhbHVlKSA/IDEgOiAwXG4gICAgZSA9IGVNYXhcbiAgfSBlbHNlIHtcbiAgICBlID0gTWF0aC5mbG9vcihNYXRoLmxvZyh2YWx1ZSkgLyBNYXRoLkxOMilcbiAgICBpZiAodmFsdWUgKiAoYyA9IE1hdGgucG93KDIsIC1lKSkgPCAxKSB7XG4gICAgICBlLS1cbiAgICAgIGMgKj0gMlxuICAgIH1cbiAgICBpZiAoZSArIGVCaWFzID49IDEpIHtcbiAgICAgIHZhbHVlICs9IHJ0IC8gY1xuICAgIH0gZWxzZSB7XG4gICAgICB2YWx1ZSArPSBydCAqIE1hdGgucG93KDIsIDEgLSBlQmlhcylcbiAgICB9XG4gICAgaWYgKHZhbHVlICogYyA+PSAyKSB7XG4gICAgICBlKytcbiAgICAgIGMgLz0gMlxuICAgIH1cblxuICAgIGlmIChlICsgZUJpYXMgPj0gZU1heCkge1xuICAgICAgbSA9IDBcbiAgICAgIGUgPSBlTWF4XG4gICAgfSBlbHNlIGlmIChlICsgZUJpYXMgPj0gMSkge1xuICAgICAgbSA9ICh2YWx1ZSAqIGMgLSAxKSAqIE1hdGgucG93KDIsIG1MZW4pXG4gICAgICBlID0gZSArIGVCaWFzXG4gICAgfSBlbHNlIHtcbiAgICAgIG0gPSB2YWx1ZSAqIE1hdGgucG93KDIsIGVCaWFzIC0gMSkgKiBNYXRoLnBvdygyLCBtTGVuKVxuICAgICAgZSA9IDBcbiAgICB9XG4gIH1cblxuICBmb3IgKDsgbUxlbiA+PSA4OyBidWZmZXJbb2Zmc2V0ICsgaV0gPSBtICYgMHhmZiwgaSArPSBkLCBtIC89IDI1NiwgbUxlbiAtPSA4KSB7fVxuXG4gIGUgPSAoZSA8PCBtTGVuKSB8IG1cbiAgZUxlbiArPSBtTGVuXG4gIGZvciAoOyBlTGVuID4gMDsgYnVmZmVyW29mZnNldCArIGldID0gZSAmIDB4ZmYsIGkgKz0gZCwgZSAvPSAyNTYsIGVMZW4gLT0gOCkge31cblxuICBidWZmZXJbb2Zmc2V0ICsgaSAtIGRdIHw9IHMgKiAxMjhcbn1cbiIsIlxuLyoqXG4gKiBpc0FycmF5XG4gKi9cblxudmFyIGlzQXJyYXkgPSBBcnJheS5pc0FycmF5O1xuXG4vKipcbiAqIHRvU3RyaW5nXG4gKi9cblxudmFyIHN0ciA9IE9iamVjdC5wcm90b3R5cGUudG9TdHJpbmc7XG5cbi8qKlxuICogV2hldGhlciBvciBub3QgdGhlIGdpdmVuIGB2YWxgXG4gKiBpcyBhbiBhcnJheS5cbiAqXG4gKiBleGFtcGxlOlxuICpcbiAqICAgICAgICBpc0FycmF5KFtdKTtcbiAqICAgICAgICAvLyA+IHRydWVcbiAqICAgICAgICBpc0FycmF5KGFyZ3VtZW50cyk7XG4gKiAgICAgICAgLy8gPiBmYWxzZVxuICogICAgICAgIGlzQXJyYXkoJycpO1xuICogICAgICAgIC8vID4gZmFsc2VcbiAqXG4gKiBAcGFyYW0ge21peGVkfSB2YWxcbiAqIEByZXR1cm4ge2Jvb2x9XG4gKi9cblxubW9kdWxlLmV4cG9ydHMgPSBpc0FycmF5IHx8IGZ1bmN0aW9uICh2YWwpIHtcbiAgcmV0dXJuICEhIHZhbCAmJiAnW29iamVjdCBBcnJheV0nID09IHN0ci5jYWxsKHZhbCk7XG59O1xuIiwiLyoqXG4gKiBFcGljZW50ZXIgSmF2YXNjcmlwdCBsaWJyYXJpZXNcbiAqIHY8JT0gdmVyc2lvbiAlPlxuICogaHR0cHM6Ly9naXRodWIuY29tL2ZvcmlvL2VwaWNlbnRlci1qcy1saWJzXG4gKi9cblxudmFyIEYgPSB7XG4gICAgdXRpbDoge30sXG4gICAgZmFjdG9yeToge30sXG4gICAgdHJhbnNwb3J0OiB7fSxcbiAgICBzdG9yZToge30sXG4gICAgc2VydmljZToge30sXG4gICAgbWFuYWdlcjoge1xuICAgICAgICBzdHJhdGVneToge31cbiAgICB9LFxuXG59O1xuXG5GLnV0aWwucXVlcnkgPSByZXF1aXJlKCcuL3V0aWwvcXVlcnktdXRpbCcpO1xuRi51dGlsLm1ha2VTZXF1ZW5jZSA9IHJlcXVpcmUoJy4vdXRpbC9tYWtlLXNlcXVlbmNlJyk7XG5GLnV0aWwucnVuID0gcmVxdWlyZSgnLi91dGlsL3J1bi11dGlsJyk7XG5GLnV0aWwuY2xhc3NGcm9tID0gcmVxdWlyZSgnLi91dGlsL2luaGVyaXQnKTtcblxuRi5mYWN0b3J5LlRyYW5zcG9ydCA9IHJlcXVpcmUoJy4vdHJhbnNwb3J0L2h0dHAtdHJhbnNwb3J0LWZhY3RvcnknKTtcbkYudHJhbnNwb3J0LkFqYXggPSByZXF1aXJlKCcuL3RyYW5zcG9ydC9hamF4LWh0dHAtdHJhbnNwb3J0Jyk7XG5cbkYuc2VydmljZS5VUkwgPSByZXF1aXJlKCcuL3NlcnZpY2UvdXJsLWNvbmZpZy1zZXJ2aWNlJyk7XG5GLnNlcnZpY2UuQ29uZmlnID0gcmVxdWlyZSgnLi9zZXJ2aWNlL2NvbmZpZ3VyYXRpb24tc2VydmljZScpO1xuRi5zZXJ2aWNlLlJ1biA9IHJlcXVpcmUoJy4vc2VydmljZS9ydW4tYXBpLXNlcnZpY2UnKTtcbkYuc2VydmljZS5WYXJpYWJsZXMgPSByZXF1aXJlKCcuL3NlcnZpY2UvdmFyaWFibGVzLWFwaS1zZXJ2aWNlJyk7XG5GLnNlcnZpY2UuRGF0YSA9IHJlcXVpcmUoJy4vc2VydmljZS9kYXRhLWFwaS1zZXJ2aWNlJyk7XG5GLnNlcnZpY2UuQXV0aCA9IHJlcXVpcmUoJy4vc2VydmljZS9hdXRoLWFwaS1zZXJ2aWNlJyk7XG5GLnNlcnZpY2UuV29ybGQgPSByZXF1aXJlKCcuL3NlcnZpY2Uvd29ybGQtYXBpLWFkYXB0ZXInKTtcbkYuc2VydmljZS5TdGF0ZSA9IHJlcXVpcmUoJy4vc2VydmljZS9zdGF0ZS1hcGktYWRhcHRlcicpO1xuRi5zZXJ2aWNlLlVzZXIgPSByZXF1aXJlKCcuL3NlcnZpY2UvdXNlci1hcGktYWRhcHRlcicpO1xuRi5zZXJ2aWNlLk1lbWJlciA9IHJlcXVpcmUoJy4vc2VydmljZS9tZW1iZXItYXBpLWFkYXB0ZXInKTtcblxuRi5zdG9yZS5Db29raWUgPSByZXF1aXJlKCcuL3N0b3JlL2Nvb2tpZS1zdG9yZScpO1xuRi5mYWN0b3J5LlN0b3JlID0gcmVxdWlyZSgnLi9zdG9yZS9zdG9yZS1mYWN0b3J5Jyk7XG5cbkYubWFuYWdlci5TY2VuYXJpb01hbmFnZXIgPSByZXF1aXJlKCcuL21hbmFnZXJzL3NjZW5hcmlvLW1hbmFnZXInKTtcbkYubWFuYWdlci5SdW5NYW5hZ2VyID0gcmVxdWlyZSgnLi9tYW5hZ2Vycy9ydW4tbWFuYWdlcicpO1xuRi5tYW5hZ2VyLkF1dGhNYW5hZ2VyID0gcmVxdWlyZSgnLi9tYW5hZ2Vycy9hdXRoLW1hbmFnZXInKTtcbkYubWFuYWdlci5Xb3JsZE1hbmFnZXIgPSByZXF1aXJlKCcuL21hbmFnZXJzL3dvcmxkLW1hbmFnZXInKTtcblxuRi5tYW5hZ2VyLnN0cmF0ZWd5WydhbHdheXMtbmV3J10gPSByZXF1aXJlKCcuL21hbmFnZXJzL3J1bi1zdHJhdGVnaWVzL2Fsd2F5cy1uZXctc3RyYXRlZ3knKTtcbkYubWFuYWdlci5zdHJhdGVneVsnY29uZGl0aW9uYWwtY3JlYXRpb24nXSA9IHJlcXVpcmUoJy4vbWFuYWdlcnMvcnVuLXN0cmF0ZWdpZXMvY29uZGl0aW9uYWwtY3JlYXRpb24tc3RyYXRlZ3knKTtcbkYubWFuYWdlci5zdHJhdGVneS5pZGVudGl0eSA9IHJlcXVpcmUoJy4vbWFuYWdlcnMvcnVuLXN0cmF0ZWdpZXMvaWRlbnRpdHktc3RyYXRlZ3knKTtcbkYubWFuYWdlci5zdHJhdGVneVsnbmV3LWlmLW1pc3NpbmcnXSA9IHJlcXVpcmUoJy4vbWFuYWdlcnMvcnVuLXN0cmF0ZWdpZXMvbmV3LWlmLW1pc3Npbmctc3RyYXRlZ3knKTtcbkYubWFuYWdlci5zdHJhdGVneVsnbmV3LWlmLW1pc3NpbmcnXSA9IHJlcXVpcmUoJy4vbWFuYWdlcnMvcnVuLXN0cmF0ZWdpZXMvbmV3LWlmLW1pc3Npbmctc3RyYXRlZ3knKTtcbkYubWFuYWdlci5zdHJhdGVneVsnbmV3LWlmLXBlcnNpc3RlZCddID0gcmVxdWlyZSgnLi9tYW5hZ2Vycy9ydW4tc3RyYXRlZ2llcy9uZXctaWYtcGVyc2lzdGVkLXN0cmF0ZWd5Jyk7XG5GLm1hbmFnZXIuc3RyYXRlZ3lbJ25ldy1pZi1pbml0aWFsaXplZCddID0gcmVxdWlyZSgnLi9tYW5hZ2Vycy9ydW4tc3RyYXRlZ2llcy9uZXctaWYtaW5pdGlhbGl6ZWQtc3RyYXRlZ3knKTtcblxuRi5tYW5hZ2VyLkNoYW5uZWxNYW5hZ2VyID0gcmVxdWlyZSgnLi9tYW5hZ2Vycy9lcGljZW50ZXItY2hhbm5lbC1tYW5hZ2VyJyk7XG5GLnNlcnZpY2UuQ2hhbm5lbCA9IHJlcXVpcmUoJy4vc2VydmljZS9jaGFubmVsLXNlcnZpY2UnKTtcblxuRi52ZXJzaW9uID0gJzwlPSB2ZXJzaW9uICU+JztcbndpbmRvdy5GID0gRjtcblxuIiwiLyoqXG4qICMjIEF1dGhvcml6YXRpb24gTWFuYWdlclxuKlxuKiBUaGUgQXV0aG9yaXphdGlvbiBNYW5hZ2VyIHByb3ZpZGVzIGFuIGVhc3kgd2F5IHRvIG1hbmFnZSB1c2VyIGF1dGhlbnRpY2F0aW9uIChsb2dnaW5nIGluIGFuZCBvdXQpIGFuZCBhdXRob3JpemF0aW9uIChrZWVwaW5nIHRyYWNrIG9mIHRva2Vucywgc2Vzc2lvbnMsIGFuZCBncm91cHMpIGZvciBwcm9qZWN0cy5cbipcbiogVGhlIEF1dGhvcml6YXRpb24gTWFuYWdlciBpcyBtb3N0IHVzZWZ1bCBmb3IgW3RlYW0gcHJvamVjdHNdKC4uLy4uLy4uL2dsb3NzYXJ5LyN0ZWFtKSB3aXRoIGFuIGFjY2VzcyBsZXZlbCBvZiBbQXV0aGVudGljYXRlZF0oLi4vLi4vLi4vZ2xvc3NhcnkvI2FjY2VzcykuIFRoZXNlIHByb2plY3RzIGFyZSBhY2Nlc3NlZCBieSBbZW5kIHVzZXJzXSguLi8uLi8uLi9nbG9zc2FyeS8jdXNlcnMpIHdobyBhcmUgbWVtYmVycyBvZiBvbmUgb3IgbW9yZSBbZ3JvdXBzXSguLi8uLi8uLi9nbG9zc2FyeS8jZ3JvdXBzKS5cbipcbiogIyMjI1VzaW5nIHRoZSBBdXRob3JpemF0aW9uIE1hbmFnZXJcbipcbiogVG8gdXNlIHRoZSBBdXRob3JpemF0aW9uIE1hbmFnZXIsIGluc3RhbnRpYXRlIGl0LiBUaGVuLCBtYWtlIGNhbGxzIHRvIGFueSBvZiB0aGUgbWV0aG9kcyB5b3UgbmVlZDpcbipcbiogICAgICAgdmFyIGF1dGhNZ3IgPSBuZXcgRi5tYW5hZ2VyLkF1dGhNYW5hZ2VyKHtcbiogICAgICAgICAgIGFjY291bnQ6ICdhY21lLXNpbXVsYXRpb25zJyxcbiogICAgICAgICAgIHVzZXJOYW1lOiAnZW5kdXNlcjEnLFxuKiAgICAgICAgICAgcGFzc3dvcmQ6ICdwYXNzdzByZCdcbiogICAgICAgfSk7XG4qICAgICAgIGF1dGhNZ3IubG9naW4oKTtcbiogICAgICAgYXV0aE1nci5nZXRDdXJyZW50VXNlclNlc3Npb25JbmZvKCk7XG4qXG4qIFRoZSBgb3B0aW9uc2Agb2JqZWN0IHBhc3NlZCB0byB0aGUgYEYubWFuYWdlci5BdXRoTWFuYWdlcigpYCBjYWxsIGNhbiBpbmNsdWRlOlxuKlxuKiAgICogYGFjY291bnRgOiBUaGUgYWNjb3VudCBpZCBmb3IgdGhpcyBgdXNlck5hbWVgLiBJbiB0aGUgRXBpY2VudGVyIFVJLCB0aGlzIGlzIHRoZSAqKlRlYW0gSUQqKiAoZm9yIHRlYW0gcHJvamVjdHMpIG9yIHRoZSAqKlVzZXIgSUQqKiAoZm9yIHBlcnNvbmFsIHByb2plY3RzKS5cbiogICAqIGB1c2VyTmFtZWA6IEVtYWlsIG9yIHVzZXJuYW1lIHRvIHVzZSBmb3IgbG9nZ2luZyBpbi5cbiogICAqIGBwYXNzd29yZGA6IFBhc3N3b3JkIGZvciBzcGVjaWZpZWQgYHVzZXJOYW1lYC5cbiogICAqIGBwcm9qZWN0YDogVGhlICoqUHJvamVjdCBJRCoqIGZvciB0aGUgcHJvamVjdCB0byBsb2cgdGhpcyB1c2VyIGludG8uIE9wdGlvbmFsLlxuKiAgICogYGdyb3VwYDogTmFtZSBvZiB0aGUgZ3JvdXAgdG8gd2hpY2ggYHVzZXJOYW1lYCBiZWxvbmdzLiBSZXF1aXJlZCBmb3IgZW5kIHVzZXJzIGlmIHRoZSBgcHJvamVjdGAgaXMgc3BlY2lmaWVkLlxuKlxuKiBJZiB5b3UgcHJlZmVyIHN0YXJ0aW5nIGZyb20gYSB0ZW1wbGF0ZSwgdGhlIEVwaWNlbnRlciBKUyBMaWJzIFtMb2dpbiBDb21wb25lbnRdKC4uLy4uLyNjb21wb25lbnRzKSB1c2VzIHRoZSBBdXRob3JpemF0aW9uIE1hbmFnZXIgYXMgd2VsbC4gVGhpcyBzYW1wbGUgSFRNTCBwYWdlIChhbmQgYXNzb2NpYXRlZCBDU1MgYW5kIEpTIGZpbGVzKSBwcm92aWRlcyBhIGxvZ2luIGZvcm0gZm9yIHRlYW0gbWVtYmVycyBhbmQgZW5kIHVzZXJzIG9mIHlvdXIgcHJvamVjdC4gSXQgYWxzbyBpbmNsdWRlcyBhIGdyb3VwIHNlbGVjdG9yIGZvciBlbmQgdXNlcnMgdGhhdCBhcmUgbWVtYmVycyBvZiBtdWx0aXBsZSBncm91cHMuXG4qL1xuXG4ndXNlIHN0cmljdCc7XG52YXIgQ29uZmlnU2VydmljZSA9IHJlcXVpcmUoJy4uL3NlcnZpY2UvY29uZmlndXJhdGlvbi1zZXJ2aWNlJyk7XG52YXIgQXV0aEFkYXB0ZXIgPSByZXF1aXJlKCcuLi9zZXJ2aWNlL2F1dGgtYXBpLXNlcnZpY2UnKTtcbnZhciBNZW1iZXJBZGFwdGVyID0gcmVxdWlyZSgnLi4vc2VydmljZS9tZW1iZXItYXBpLWFkYXB0ZXInKTtcbnZhciBTdG9yYWdlRmFjdG9yeSA9IHJlcXVpcmUoJy4uL3N0b3JlL3N0b3JlLWZhY3RvcnknKTtcbnZhciBCdWZmZXIgPSByZXF1aXJlKCdidWZmZXInKS5CdWZmZXI7XG52YXIga2V5TmFtZXMgPSByZXF1aXJlKCcuL2tleS1uYW1lcycpO1xuXG52YXIgZGVmYXVsdHMgPSB7XG4gICAgLyoqXG4gICAgICogV2hlcmUgdG8gc3RvcmUgdXNlciBhY2Nlc3MgdG9rZW5zIGZvciB0ZW1wb3JhcnkgYWNjZXNzLiBEZWZhdWx0cyB0byBzdG9yaW5nIGluIGEgY29va2llIGluIHRoZSBicm93c2VyLlxuICAgICAqIEB0eXBlIHtzdHJpbmd9XG4gICAgICovXG4gICAgc3RvcmU6IHsgc3luY2hyb25vdXM6IHRydWUgfVxufTtcblxudmFyIEVQSV9DT09LSUVfS0VZID0ga2V5TmFtZXMuRVBJX0NPT0tJRV9LRVk7XG52YXIgRVBJX1NFU1NJT05fS0VZID0ga2V5TmFtZXMuRVBJX1NFU1NJT05fS0VZO1xudmFyIHN0b3JlO1xudmFyIHRva2VuO1xudmFyIHNlc3Npb247XG5cbmZ1bmN0aW9uIHNhdmVTZXNzaW9uKHVzZXJJbmZvKSB7XG4gICAgdmFyIHNlcmlhbGl6ZWQgPSBKU09OLnN0cmluZ2lmeSh1c2VySW5mbyk7XG4gICAgc3RvcmUuc2V0KEVQSV9TRVNTSU9OX0tFWSwgc2VyaWFsaXplZCk7XG5cbiAgICAvL2pzaGludCBjYW1lbGNhc2U6IGZhbHNlXG4gICAgLy9qc2NzOmRpc2FibGVcbiAgICBzdG9yZS5zZXQoRVBJX0NPT0tJRV9LRVksIHVzZXJJbmZvLmF1dGhfdG9rZW4pO1xufVxuXG5mdW5jdGlvbiBnZXRTZXNzaW9uKCkge1xuICAgIHZhciBzZXNzaW9uID0gc3RvcmUuZ2V0KEVQSV9TRVNTSU9OX0tFWSkgfHwgJ3t9JztcbiAgICByZXR1cm4gSlNPTi5wYXJzZShzZXNzaW9uKTtcbn1cblxuZnVuY3Rpb24gQXV0aE1hbmFnZXIob3B0aW9ucykge1xuICAgIHRoaXMub3B0aW9ucyA9ICQuZXh0ZW5kKHRydWUsIHt9LCBkZWZhdWx0cywgb3B0aW9ucyk7XG5cbiAgICB2YXIgdXJsQ29uZmlnID0gbmV3IENvbmZpZ1NlcnZpY2UodGhpcy5vcHRpb25zKS5nZXQoJ3NlcnZlcicpO1xuICAgIGlmICghdGhpcy5vcHRpb25zLmFjY291bnQpIHtcbiAgICAgICAgdGhpcy5vcHRpb25zLmFjY291bnQgPSB1cmxDb25maWcuYWNjb3VudFBhdGg7XG4gICAgfVxuXG4gICAgLy8gbnVsbCBtaWdodCBzcGVjaWZpZWQgdG8gZGlzYWJsZSBwcm9qZWN0IGZpbHRlcmluZ1xuICAgIGlmICh0aGlzLm9wdGlvbnMucHJvamVjdCA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICAgIHRoaXMub3B0aW9ucy5wcm9qZWN0ID0gdXJsQ29uZmlnLnByb2plY3RQYXRoO1xuICAgIH1cblxuICAgIHN0b3JlID0gbmV3IFN0b3JhZ2VGYWN0b3J5KHRoaXMub3B0aW9ucy5zdG9yZSk7XG4gICAgc2Vzc2lvbiA9IGdldFNlc3Npb24oKTtcbiAgICB0b2tlbiA9IHN0b3JlLmdldChFUElfQ09PS0lFX0tFWSkgfHwgJyc7XG4gICAgLy9qc2hpbnQgY2FtZWxjYXNlOiBmYWxzZVxuICAgIC8vanNjczpkaXNhYmxlXG4gICAgdGhpcy5hdXRoQWRhcHRlciA9IG5ldyBBdXRoQWRhcHRlcih0aGlzLm9wdGlvbnMsIHsgdG9rZW46IHNlc3Npb24uYXV0aF90b2tlbiB9KTtcbn1cblxudmFyIF9maW5kVXNlckluR3JvdXAgPSBmdW5jdGlvbiAobWVtYmVycywgaWQpIHtcbiAgICBmb3IgKHZhciBqID0gMDsgajxtZW1iZXJzLmxlbmd0aDsgaisrKSB7XG4gICAgICAgIGlmIChtZW1iZXJzW2pdLnVzZXJJZCA9PT0gaWQpIHtcbiAgICAgICAgICAgIHJldHVybiBtZW1iZXJzW2pdO1xuICAgICAgICB9XG4gICAgfVxuXG5cbiAgICByZXR1cm4gbnVsbDtcbn07XG5cbkF1dGhNYW5hZ2VyLnByb3RvdHlwZSA9ICQuZXh0ZW5kKEF1dGhNYW5hZ2VyLnByb3RvdHlwZSwge1xuXG4gICAgLyoqXG4gICAgKiBMb2dzIHVzZXIgaW4uXG4gICAgKlxuICAgICogKipFeGFtcGxlKipcbiAgICAqXG4gICAgKiAgICAgICBhdXRoTWdyLmxvZ2luKHtcbiAgICAqICAgICAgICAgICBhY2NvdW50OiAnYWNtZS1zaW11bGF0aW9ucycsIFxuICAgICogICAgICAgICAgIHVzZXJOYW1lOiAnZW5kdXNlcjEnLCBcbiAgICAqICAgICAgICAgICBwYXNzd29yZDogJ3Bhc3N3MHJkJyBcbiAgICAqICAgICAgIH0pO1xuICAgICpcbiAgICAqICAgICAgIGF1dGhNZ3IubG9naW4oKVxuICAgICogICAgICAgICAgIC50aGVuKGZ1bmN0aW9uKGF1dGhBZGFwdGVyKSB7XG4gICAgKiAgICAgICAgICAgICAgIC8vIGlmIGVuZHVzZXIxIGJlbG9uZ3MgdG8gZXhhY3RseSBvbmUgZ3JvdXBcbiAgICAqICAgICAgICAgICAgICAgLy8gKG9yIGlmIHRoZSBsb2dpbigpIGNhbGwgaXMgbW9kaWZpZWQgdG8gaW5jbHVkZSB0aGUgZ3JvdXApXG4gICAgKiAgICAgICAgICAgICAgIC8vIGNvbnRpbnVlIGhlcmVcbiAgICAqICAgICAgICAgICB9KVxuICAgICogICAgICAgICAgIC5mYWlsKGZ1bmN0aW9uKGF1dGhBZGFwdGVyKSB7XG4gICAgKiAgICAgICAgICAgICAgIC8vIGlmIGVuZHVzZXIxIGJlbG9uZ3MgdG8gbXVsdGlwbGUgZ3JvdXBzLCBcbiAgICAqICAgICAgICAgICAgICAgLy8gdGhlIGxvZ2luKCkgY2FsbCBmYWlscyBcbiAgICAqICAgICAgICAgICAgICAgLy8gYW5kIHJldHVybnMgYWxsIGdyb3VwcyBvZiB3aGljaCB0aGUgdXNlciBpcyBhIG1lbWJlclxuICAgICogICAgICAgICAgIH0pO1xuICAgICpcbiAgICAqICoqUGFyYW1ldGVycyoqXG4gICAgKlxuICAgICogQHBhcmFtIHtPYmplY3R9IGBvcHRpb25zYCAoT3B0aW9uYWwpIE92ZXJyaWRlcyBmb3IgY29uZmlndXJhdGlvbiBvcHRpb25zLiBJZiBub3QgcGFzc2VkIGluIHdoZW4gY3JlYXRpbmcgYW4gaW5zdGFuY2Ugb2YgdGhlIG1hbmFnZXIgKGBGLm1hbmFnZXIuQXV0aE1hbmFnZXIoKWApLCB0aGVzZSBvcHRpb25zIHNob3VsZCBpbmNsdWRlOiBcbiAgICAqIEBwYXJhbSB7c3RyaW5nfSBgb3B0aW9ucy5hY2NvdW50YCBUaGUgYWNjb3VudCBpZCBmb3IgdGhpcyBgdXNlck5hbWVgLiBJbiB0aGUgRXBpY2VudGVyIFVJLCB0aGlzIGlzIHRoZSAqKlRlYW0gSUQqKiAoZm9yIHRlYW0gcHJvamVjdHMpIG9yIHRoZSAqKlVzZXIgSUQqKiAoZm9yIHBlcnNvbmFsIHByb2plY3RzKS5cbiAgICAqIEBwYXJhbSB7c3RyaW5nfSBgb3B0aW9ucy51c2VyTmFtZWAgRW1haWwgb3IgdXNlcm5hbWUgdG8gdXNlIGZvciBsb2dnaW5nIGluLlxuICAgICogQHBhcmFtIHtzdHJpbmd9IGBvcHRpb25zLnBhc3N3b3JkYCBQYXNzd29yZCBmb3Igc3BlY2lmaWVkIGB1c2VyTmFtZWAuXG4gICAgKiBAcGFyYW0ge3N0cmluZ30gYG9wdGlvbnMucHJvamVjdGAgKE9wdGlvbmFsKSBUaGUgKipQcm9qZWN0IElEKiogZm9yIHRoZSBwcm9qZWN0IHRvIGxvZyB0aGlzIHVzZXIgaW50by5cbiAgICAqIEBwYXJhbSB7c3RyaW5nfSBgb3B0aW9ucy5ncm91cGAgTmFtZSBvZiB0aGUgZ3JvdXAgdG8gd2hpY2ggYHVzZXJOYW1lYCBiZWxvbmdzLiBSZXF1aXJlZCBmb3IgW2VuZCB1c2Vyc10oLi4vLi4vLi4vZ2xvc3NhcnkvI3VzZXJzKSBpZiB0aGUgYHByb2plY3RgIGlzIHNwZWNpZmllZCwgYW5kIGZvciBlbmQgdXNlcnMgdGhhdCBhcmUgbWVtYmVycyBvZiBtdWx0aXBsZSBbZ3JvdXBzXSguLi8uLi8uLi9nbG9zc2FyeS8jZ3JvdXBzKSwgb3RoZXJ3aXNlIG9wdGlvbmFsLlxuICAgICovXG4gICAgbG9naW46IGZ1bmN0aW9uIChvcHRpb25zKSB7XG4gICAgICAgIHZhciBfdGhpcyA9IHRoaXM7XG4gICAgICAgIHZhciAkZCA9ICQuRGVmZXJyZWQoKTtcbiAgICAgICAgdmFyIGFkYXB0ZXJPcHRpb25zID0gJC5leHRlbmQodHJ1ZSwgeyBzdWNjZXNzOiAkLm5vb3AsIGVycm9yOiAkLm5vb3AgfSwgdGhpcy5vcHRpb25zLCBvcHRpb25zKTtcbiAgICAgICAgdmFyIG91dFN1Y2Nlc3MgPSBhZGFwdGVyT3B0aW9ucy5zdWNjZXNzO1xuICAgICAgICB2YXIgb3V0RXJyb3IgPSBhZGFwdGVyT3B0aW9ucy5lcnJvcjtcbiAgICAgICAgdmFyIGdyb3VwSWQgPSBhZGFwdGVyT3B0aW9ucy5ncm91cElkO1xuXG4gICAgICAgIHZhciBkZWNvZGVUb2tlbiA9IGZ1bmN0aW9uICh0b2tlbikge1xuICAgICAgICAgICAgdmFyIGVuY29kZWQgPSB0b2tlbi5zcGxpdCgnLicpWzFdO1xuICAgICAgICAgICAgd2hpbGUgKGVuY29kZWQubGVuZ3RoICUgNCAhPT0gMCkge1xuICAgICAgICAgICAgICAgIGVuY29kZWQgKz0gJz0nO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICB2YXIgZGVjb2RlID0gd2luZG93LmF0b2IgPyB3aW5kb3cuYXRvYiA6IGZ1bmN0aW9uIChlbmNvZGVkKSB7IHJldHVybiBuZXcgQnVmZmVyKGVuY29kZWQsICdiYXNlNjQnKS50b1N0cmluZygnYXNjaWknKTsgfTtcblxuICAgICAgICAgICAgcmV0dXJuIEpTT04ucGFyc2UoZGVjb2RlKGVuY29kZWQpKTtcbiAgICAgICAgfTtcblxuICAgICAgICB2YXIgaGFuZGxlR3JvdXBFcnJvciA9IGZ1bmN0aW9uIChtZXNzYWdlLCBzdGF0dXNDb2RlLCBkYXRhKSB7XG4gICAgICAgICAgICAvLyBsb2dvdXQgdGhlIHVzZXIgc2luY2UgaXQncyBpbiBhbiBpbnZhbGlkIHN0YXRlIHdpdGggbm8gZ3JvdXAgc2VsZWN0ZWRcbiAgICAgICAgICAgIF90aGlzLmxvZ291dCgpLnRoZW4oZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgICAgIHZhciBlcnJvciA9ICQuZXh0ZW5kKHRydWUsIHt9LCBkYXRhLCB7IHN0YXR1c1RleHQ6IG1lc3NhZ2UsIHN0YXR1czogc3RhdHVzQ29kZSB9KTtcbiAgICAgICAgICAgICAgICAkZC5yZWplY3QoZXJyb3IpO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgIH07XG5cbiAgICAgICAgdmFyIGhhbmRsZVN1Y2Nlc3MgPSBmdW5jdGlvbiAocmVzcG9uc2UpIHtcbiAgICAgICAgICAgIC8vanNoaW50IGNhbWVsY2FzZTogZmFsc2VcbiAgICAgICAgICAgIC8vanNjczpkaXNhYmxlXG4gICAgICAgICAgICB0b2tlbiA9IHJlc3BvbnNlLmFjY2Vzc190b2tlbjtcblxuICAgICAgICAgICAgdmFyIHVzZXJJbmZvID0gZGVjb2RlVG9rZW4odG9rZW4pO1xuICAgICAgICAgICAgdmFyIHVzZXJHcm91cE9wdHMgPSAkLmV4dGVuZCh0cnVlLCB7fSwgYWRhcHRlck9wdGlvbnMsIHsgc3VjY2VzczogJC5ub29wLCB0b2tlbjogdG9rZW4gfSk7XG4gICAgICAgICAgICBfdGhpcy5nZXRVc2VyR3JvdXBzKHsgdXNlcklkOiB1c2VySW5mby51c2VyX2lkLCB0b2tlbjogdG9rZW4gfSwgdXNlckdyb3VwT3B0cykuZG9uZSggZnVuY3Rpb24gKG1lbWJlckluZm8pIHtcbiAgICAgICAgICAgICAgICB2YXIgZGF0YSA9IHthdXRoOiByZXNwb25zZSwgdXNlcjogdXNlckluZm8sIHVzZXJHcm91cHM6IG1lbWJlckluZm8sIGdyb3VwU2VsZWN0aW9uOiB7fSB9O1xuXG4gICAgICAgICAgICAgICAgdmFyIHNlc3Npb25JbmZvID0ge1xuICAgICAgICAgICAgICAgICAgICAnYXV0aF90b2tlbic6IHRva2VuLFxuICAgICAgICAgICAgICAgICAgICAnYWNjb3VudCc6IGFkYXB0ZXJPcHRpb25zLmFjY291bnQsXG4gICAgICAgICAgICAgICAgICAgICdwcm9qZWN0JzogYWRhcHRlck9wdGlvbnMucHJvamVjdCxcbiAgICAgICAgICAgICAgICAgICAgJ3VzZXJJZCc6IHVzZXJJbmZvLnVzZXJfaWRcbiAgICAgICAgICAgICAgICB9O1xuICAgICAgICAgICAgICAgIC8vIFRoZSBncm91cCBpcyBub3QgcmVxdWlyZWQgaWYgdGhlIHVzZXIgaXMgbm90IGxvZ2dpbmcgaW50byBhIHByb2plY3RcbiAgICAgICAgICAgICAgICBpZiAoIWFkYXB0ZXJPcHRpb25zLnByb2plY3QpIHtcbiAgICAgICAgICAgICAgICAgICAgc2F2ZVNlc3Npb24oc2Vzc2lvbkluZm8pO1xuICAgICAgICAgICAgICAgICAgICBvdXRTdWNjZXNzLmFwcGx5KHRoaXMsIFtkYXRhXSk7XG4gICAgICAgICAgICAgICAgICAgICRkLnJlc29sdmUoZGF0YSk7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICB2YXIgZ3JvdXAgPSBudWxsO1xuICAgICAgICAgICAgICAgIGlmIChtZW1iZXJJbmZvLmxlbmd0aCA9PT0gMCkge1xuICAgICAgICAgICAgICAgICAgICBoYW5kbGVHcm91cEVycm9yKCdUaGUgdXNlciBoYXMgbm8gZ3JvdXBzIGFzc29jaWF0ZWQgaW4gdGhpcyBhY2NvdW50JywgNDAxLCBkYXRhKTtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgICAgIH0gZWxzZSBpZiAobWVtYmVySW5mby5sZW5ndGggPT09IDEpIHtcbiAgICAgICAgICAgICAgICAgICAgLy8gU2VsZWN0IHRoZSBvbmx5IGdyb3VwXG4gICAgICAgICAgICAgICAgICAgIGdyb3VwID0gbWVtYmVySW5mb1swXTtcbiAgICAgICAgICAgICAgICB9IGVsc2UgaWYgKG1lbWJlckluZm8ubGVuZ3RoID4gMSkge1xuICAgICAgICAgICAgICAgICAgICBpZiAoZ3JvdXBJZCkge1xuICAgICAgICAgICAgICAgICAgICAgICAgdmFyIGZpbHRlcmVkR3JvdXBzID0gJC5ncmVwKG1lbWJlckluZm8sIGZ1bmN0aW9uIChyZXNHcm91cCkge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiByZXNHcm91cC5ncm91cElkID09PSBncm91cElkO1xuICAgICAgICAgICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAgICAgICAgICAgICBncm91cCA9IGZpbHRlcmVkR3JvdXBzLmxlbmd0aCA9PT0gMSA/IGZpbHRlcmVkR3JvdXBzWzBdIDogbnVsbDtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgIGlmIChncm91cCkge1xuICAgICAgICAgICAgICAgICAgICB2YXIgZ3JvdXBTZWxlY3Rpb24gPSBncm91cC5ncm91cElkO1xuICAgICAgICAgICAgICAgICAgICBkYXRhLmdyb3VwU2VsZWN0aW9uW2FkYXB0ZXJPcHRpb25zLnByb2plY3RdID0gZ3JvdXBTZWxlY3Rpb247XG4gICAgICAgICAgICAgICAgICAgIHZhciBzZXNzaW9uSW5mb1dpdGhHcm91cCA9ICQuZXh0ZW5kKHt9LCBzZXNzaW9uSW5mbywge1xuICAgICAgICAgICAgICAgICAgICAgICAgJ2dyb3VwSWQnOiBncm91cC5ncm91cElkLFxuICAgICAgICAgICAgICAgICAgICAgICAgJ2dyb3VwTmFtZSc6IGdyb3VwLm5hbWUsXG4gICAgICAgICAgICAgICAgICAgICAgICAnaXNGYWMnOiBfZmluZFVzZXJJbkdyb3VwKGdyb3VwLm1lbWJlcnMsIHVzZXJJbmZvLnVzZXJfaWQpLnJvbGUgPT09ICdmYWNpbGl0YXRvcidcbiAgICAgICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAgICAgICAgIHNhdmVTZXNzaW9uKHNlc3Npb25JbmZvV2l0aEdyb3VwKTtcbiAgICAgICAgICAgICAgICAgICAgb3V0U3VjY2Vzcy5hcHBseSh0aGlzLCBbZGF0YV0pO1xuICAgICAgICAgICAgICAgICAgICAkZC5yZXNvbHZlKGRhdGEpO1xuICAgICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgICAgIGhhbmRsZUdyb3VwRXJyb3IoJ1RoaXMgYWNjb3VudCBpcyBhc3NvY2lhdGVkIHdpdGggbW9yZSB0aGF0IG9uZSBncm91cC4gUGxlYXNlIHNwZWNpZnkgYSBncm91cCBpZCB0byBsb2cgaW50byBhbmQgdHJ5IGFnYWluJywgNDAzLCBkYXRhKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9KS5mYWlsKCRkLnJlamVjdCk7XG4gICAgICAgIH07XG5cbiAgICAgICAgYWRhcHRlck9wdGlvbnMuc3VjY2VzcyA9IGhhbmRsZVN1Y2Nlc3M7XG4gICAgICAgIGFkYXB0ZXJPcHRpb25zLmVycm9yID0gZnVuY3Rpb24gKHJlc3BvbnNlKSB7XG4gICAgICAgICAgICBpZiAoYWRhcHRlck9wdGlvbnMuYWNjb3VudCkge1xuICAgICAgICAgICAgICAgIC8vIFRyeSB0byBsb2dpbiBhcyBhIHN5c3RlbSB1c2VyXG4gICAgICAgICAgICAgICAgYWRhcHRlck9wdGlvbnMuYWNjb3VudCA9IG51bGw7XG4gICAgICAgICAgICAgICAgYWRhcHRlck9wdGlvbnMuZXJyb3IgPSBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICAgICAgICAgIG91dEVycm9yLmFwcGx5KHRoaXMsIGFyZ3VtZW50cyk7XG4gICAgICAgICAgICAgICAgICAgICRkLnJlamVjdChyZXNwb25zZSk7XG4gICAgICAgICAgICAgICAgfTtcblxuICAgICAgICAgICAgICAgIF90aGlzLmF1dGhBZGFwdGVyLmxvZ2luKGFkYXB0ZXJPcHRpb25zKTtcbiAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIG91dEVycm9yLmFwcGx5KHRoaXMsIGFyZ3VtZW50cyk7XG4gICAgICAgICAgICAkZC5yZWplY3QocmVzcG9uc2UpO1xuICAgICAgICB9O1xuXG4gICAgICAgIHRoaXMuYXV0aEFkYXB0ZXIubG9naW4oYWRhcHRlck9wdGlvbnMpO1xuICAgICAgICByZXR1cm4gJGQucHJvbWlzZSgpO1xuICAgIH0sXG5cbiAgICAvKipcbiAgICAqIExvZ3MgdXNlciBvdXQuXG4gICAgKlxuICAgICogKipFeGFtcGxlKipcbiAgICAqXG4gICAgKiAgICAgICBhdXRoTWdyLmxvZ291dCgpO1xuICAgICpcbiAgICAqICoqUGFyYW1ldGVycyoqXG4gICAgKlxuICAgICogQHBhcmFtIHtPYmplY3R9IGBvcHRpb25zYCAoT3B0aW9uYWwpIE92ZXJyaWRlcyBmb3IgY29uZmlndXJhdGlvbiBvcHRpb25zLlxuICAgICovXG4gICAgbG9nb3V0OiBmdW5jdGlvbiAob3B0aW9ucykge1xuICAgICAgICB2YXIgJGQgPSAkLkRlZmVycmVkKCk7XG4gICAgICAgIHZhciBhZGFwdGVyT3B0aW9ucyA9ICQuZXh0ZW5kKHRydWUsIHtzdWNjZXNzOiAkLm5vb3AsIHRva2VuOiB0b2tlbiB9LCB0aGlzLm9wdGlvbnMsIG9wdGlvbnMpO1xuXG4gICAgICAgIHZhciByZW1vdmVDb29raWVGbiA9IGZ1bmN0aW9uIChyZXNwb25zZSkge1xuICAgICAgICAgICAgc3RvcmUucmVtb3ZlKEVQSV9DT09LSUVfS0VZLCBhZGFwdGVyT3B0aW9ucyk7XG4gICAgICAgICAgICBzdG9yZS5yZW1vdmUoRVBJX1NFU1NJT05fS0VZLCBhZGFwdGVyT3B0aW9ucyk7XG4gICAgICAgICAgICB0b2tlbiA9ICcnO1xuICAgICAgICB9O1xuXG4gICAgICAgIHZhciBvdXRTdWNjZXNzID0gYWRhcHRlck9wdGlvbnMuc3VjY2VzcztcbiAgICAgICAgYWRhcHRlck9wdGlvbnMuc3VjY2VzcyA9IGZ1bmN0aW9uIChyZXNwb25zZSkge1xuICAgICAgICAgICAgcmVtb3ZlQ29va2llRm4ocmVzcG9uc2UpO1xuICAgICAgICAgICAgb3V0U3VjY2Vzcy5hcHBseSh0aGlzLCBhcmd1bWVudHMpO1xuICAgICAgICB9O1xuXG4gICAgICAgIC8vIEVwaWNlbnRlciByZXR1cm5zIGEgYmFkIHJlcXVlc3Qgd2hlbiB0cnlpbmcgdG8gZGVsZXRlIGEgdG9rZW4uIEl0IHNlZW1zIGxpa2UgdGhlIEFQSSBjYWxsIGlzIG5vdCBpbXBsZW1lbnRlZCB5ZXRcbiAgICAgICAgLy8gT25jZSBpdCdzIGltcGxlbWVudGVkIHRoaXMgZXJyb3IgaGFuZGxlciBzaG91bGQgbm90IGJlIG5lY2Vzc2FyeS5cbiAgICAgICAgYWRhcHRlck9wdGlvbnMuZXJyb3IgPSBmdW5jdGlvbiAocmVzcG9uc2UpIHtcbiAgICAgICAgICAgIHJlbW92ZUNvb2tpZUZuKHJlc3BvbnNlKTtcbiAgICAgICAgICAgIG91dFN1Y2Nlc3MuYXBwbHkodGhpcywgYXJndW1lbnRzKTtcbiAgICAgICAgICAgICRkLnJlc29sdmUoKTtcbiAgICAgICAgfTtcblxuICAgICAgICB0aGlzLmF1dGhBZGFwdGVyLmxvZ291dChhZGFwdGVyT3B0aW9ucykuZG9uZSgkZC5yZXNvbHZlKTtcbiAgICAgICAgcmV0dXJuICRkLnByb21pc2UoKTtcbiAgICB9LFxuXG4gICAgLyoqXG4gICAgICogUmV0dXJucyB0aGUgZXhpc3RpbmcgdXNlciBhY2Nlc3MgdG9rZW4gaWYgdGhlIHVzZXIgaXMgYWxyZWFkeSBsb2dnZWQgaW4uIE90aGVyd2lzZSwgbG9ncyB0aGUgdXNlciBpbiwgY3JlYXRpbmcgYSBuZXcgdXNlciBhY2Nlc3MgdG9rZW4sIGFuZCByZXR1cm5zIHRoZSBuZXcgdG9rZW4uIChTZWUgW21vcmUgYmFja2dyb3VuZCBvbiBhY2Nlc3MgdG9rZW5zXSguLi8uLi8uLi9wcm9qZWN0X2FjY2Vzcy8pKS5cbiAgICAgKlxuICAgICAqICoqRXhhbXBsZSoqXG4gICAgICpcbiAgICAgKiAgICAgIGF1dGhNZ3IuZ2V0VG9rZW4oKVxuICAgICAqICAgICAgICAgIC50aGVuKGZ1bmN0aW9uICh0b2tlbikgeyBcbiAgICAgKiAgICAgICAgICAgICAgY29uc29sZS5sb2coJ015IHRva2VuIGlzICcsIHRva2VuKTsgXG4gICAgICogICAgICAgICAgfSk7XG4gICAgICpcbiAgICAgKiAqKlBhcmFtZXRlcnMqKlxuICAgICAqIEBwYXJhbSB7T2JqZWN0fSBgb3B0aW9uc2AgKE9wdGlvbmFsKSBPdmVycmlkZXMgZm9yIGNvbmZpZ3VyYXRpb24gb3B0aW9ucy5cbiAgICAgKi9cbiAgICBnZXRUb2tlbjogZnVuY3Rpb24gKG9wdGlvbnMpIHtcbiAgICAgICAgdmFyIGh0dHBPcHRpb25zID0gJC5leHRlbmQodHJ1ZSwgdGhpcy5vcHRpb25zLCBvcHRpb25zKTtcblxuICAgICAgICB2YXIgJGQgPSAkLkRlZmVycmVkKCk7XG4gICAgICAgIGlmICh0b2tlbikge1xuICAgICAgICAgICAgJGQucmVzb2x2ZSh0b2tlbik7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICB0aGlzLmxvZ2luKGh0dHBPcHRpb25zKS50aGVuKCRkLnJlc29sdmUpO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiAkZC5wcm9taXNlKCk7XG4gICAgfSxcblxuICAgIC8qKlxuICAgICAqIFJldHVybnMgYW4gYXJyYXkgb2YgZ3JvdXAgcmVjb3Jkcywgb25lIGZvciBlYWNoIGdyb3VwIG9mIHdoaWNoIHRoZSBjdXJyZW50IHVzZXIgaXMgYSBtZW1iZXIuIEVhY2ggZ3JvdXAgcmVjb3JkIGluY2x1ZGVzIHRoZSBncm91cCBgbmFtZWAsIGBhY2NvdW50YCwgYHByb2plY3RgLCBhbmQgYGdyb3VwSWRgLlxuICAgICAqXG4gICAgICogSWYgc29tZSBlbmQgdXNlcnMgaW4geW91ciBwcm9qZWN0IGFyZSBtZW1iZXJzIG9mIG11bHRpcGxlIGdyb3VwcywgdGhpcyBpcyBhIHVzZWZ1bCBtZXRob2QgdG8gY2FsbCBvbiB5b3VyIHByb2plY3QncyBsb2dpbiBwYWdlLiBXaGVuIHRoZSB1c2VyIGF0dGVtcHRzIHRvIGxvZyBpbiwgeW91IGNhbiB1c2UgdGhpcyB0byBkaXNwbGF5IHRoZSBncm91cHMgb2Ygd2hpY2ggdGhlIHVzZXIgaXMgbWVtYmVyLCBhbmQgaGF2ZSB0aGUgdXNlciBzZWxlY3QgdGhlIGNvcnJlY3QgZ3JvdXAgdG8gbG9nIGluIHRvIGZvciB0aGlzIHNlc3Npb24uXG4gICAgICpcbiAgICAgKiAqKkV4YW1wbGUqKlxuICAgICAqXG4gICAgICogICAgICAvLyBnZXQgZ3JvdXBzIGZvciBjdXJyZW50IHVzZXJcbiAgICAgKiAgICAgIGF1dGhNZ3IuZ2V0VXNlckdyb3VwcygpXG4gICAgICogICAgICAgICAgLnRoZW4oZnVuY3Rpb24gKGdyb3VwcykgeyBcbiAgICAgKiAgICAgICAgICAgICAgZm9yICh2YXIgaT0wOyBpIDwgZ3JvdXBzLmxlbmd0aDsgaSsrKSBcbiAgICAgKiAgICAgICAgICAgICAgICAgIHsgY29uc29sZS5sb2coZ3JvdXBzW2ldLm5hbWUpOyB9XG4gICAgICogICAgICAgICAgfSk7XG4gICAgICpcbiAgICAgKiAgICAgIC8vIGdldCBncm91cHMgZm9yIHBhcnRpY3VsYXIgdXNlclxuICAgICAqICAgICAgYXV0aE1nci5nZXRVc2VyR3JvdXBzKHt1c2VySWQ6ICdiMWMxOWRkYS0yZDJlLTQ3NzctYWQ1ZC0zOTI5ZjE3ZTg2ZDMnfSk7XG4gICAgICpcbiAgICAgKiAqKlBhcmFtZXRlcnMqKlxuICAgICAqIEBwYXJhbSB7T2JqZWN0fSBgcGFyYW1zYCAoT3B0aW9uYWwpIE9iamVjdCB3aXRoIGEgdXNlcklkIGFuZCB0b2tlbiBwcm9wZXJ0aWVzLlxuICAgICAqIEBwYXJhbSB7T2JqZWN0fSBgb3B0aW9uc2AgKE9wdGlvbmFsKSBPdmVycmlkZXMgZm9yIGNvbmZpZ3VyYXRpb24gb3B0aW9ucy5cbiAgICAgKi9cbiAgICBnZXRVc2VyR3JvdXBzOiBmdW5jdGlvbiAocGFyYW1zLCBvcHRpb25zKSB7XG4gICAgICAgIHZhciBhZGFwdGVyT3B0aW9ucyA9ICQuZXh0ZW5kKHRydWUsIHsgc3VjY2VzczogJC5ub29wIH0sIHRoaXMub3B0aW9ucywgb3B0aW9ucyk7XG4gICAgICAgIHZhciAkZCA9ICQuRGVmZXJyZWQoKTtcbiAgICAgICAgdmFyIG91dFN1Y2Nlc3MgPSBhZGFwdGVyT3B0aW9ucy5zdWNjZXNzO1xuXG4gICAgICAgIGFkYXB0ZXJPcHRpb25zLnN1Y2Nlc3MgPSBmdW5jdGlvbiAobWVtYmVySW5mbykge1xuICAgICAgICAgICAgLy8gVGhlIG1lbWJlciBBUEkgaXMgYXQgdGhlIGFjY291bnQgc2NvcGUsIHdlIGZpbHRlciBieSBwcm9qZWN0XG4gICAgICAgICAgICBpZiAoYWRhcHRlck9wdGlvbnMucHJvamVjdCkge1xuICAgICAgICAgICAgICAgIG1lbWJlckluZm8gPSAkLmdyZXAobWVtYmVySW5mbywgZnVuY3Rpb24gKGdyb3VwKSB7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybiBncm91cC5wcm9qZWN0ID09PSBhZGFwdGVyT3B0aW9ucy5wcm9qZWN0O1xuICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBvdXRTdWNjZXNzLmFwcGx5KHRoaXMsIFttZW1iZXJJbmZvXSk7XG4gICAgICAgICAgICAkZC5yZXNvbHZlKG1lbWJlckluZm8pO1xuICAgICAgICB9O1xuXG4gICAgICAgIHZhciBtZW1iZXJBZGFwdGVyID0gbmV3IE1lbWJlckFkYXB0ZXIoeyB0b2tlbjogcGFyYW1zLnRva2VuIH0pO1xuICAgICAgICBtZW1iZXJBZGFwdGVyLmdldEdyb3Vwc0J5VXNlcihwYXJhbXMsIGFkYXB0ZXJPcHRpb25zKS5mYWlsKCRkLnJlamVjdCk7XG4gICAgICAgIHJldHVybiAkZC5wcm9taXNlKCk7XG4gICAgfSxcblxuICAgIC8qKlxuICAgICAqIFJldHVybnMgc2Vzc2lvbiBpbmZvcm1hdGlvbiBmb3IgdGhlIGN1cnJlbnQgdXNlciwgaW5jbHVkaW5nIHRoZSBgdXNlcklkYCwgYGFjY291bnRgLCBgcHJvamVjdGAsIGBncm91cElkYCwgYGdyb3VwTmFtZWAsIGBpc0ZhY2AgKHdoZXRoZXIgdGhlIGVuZCB1c2VyIGlzIGEgZmFjaWxpdGF0b3Igb2YgdGhpcyBncm91cCksIGFuZCBgYXV0aF90b2tlbmAgKHVzZXIgYWNjZXNzIHRva2VuKS5cbiAgICAgKlxuICAgICAqICpJbXBvcnRhbnQqOiBUaGlzIG1ldGhvZCBpcyBzeW5jaHJvbm91cy4gVGhlIHNlc3Npb24gaW5mb3JtYXRpb24gaXMgcmV0dXJuZWQgaW1tZWRpYXRlbHkgaW4gYW4gb2JqZWN0OyBubyBjYWxsYmFja3Mgb3IgcHJvbWlzZXMgYXJlIG5lZWRlZC5cbiAgICAgKlxuICAgICAqIEJ5IGRlZmF1bHQsIHNlc3Npb24gaW5mb3JtYXRpb24gaXMgc3RvcmVkIGluIGEgY29va2llIGluIHRoZSBicm93c2VyLiBZb3UgY2FuIGNoYW5nZSB0aGlzIHdpdGggdGhlIGBzdG9yZWAgY29uZmlndXJhdGlvbiBvcHRpb24uIFxuICAgICAqXG4gICAgICogKipFeGFtcGxlKipcbiAgICAgKlxuICAgICAqICAgICAgdmFyIHNlc3Npb25PYmogPSBhdXRoTWdyLmdldEN1cnJlbnRVc2VyU2Vzc2lvbkluZm8oKTtcbiAgICAgKlxuICAgICAqICoqUGFyYW1ldGVycyoqXG4gICAgICogQHBhcmFtIHtPYmplY3R9IGBvcHRpb25zYCAoT3B0aW9uYWwpIE92ZXJyaWRlcyBmb3IgY29uZmlndXJhdGlvbiBvcHRpb25zLlxuICAgICAqL1xuICAgIGdldEN1cnJlbnRVc2VyU2Vzc2lvbkluZm86IGZ1bmN0aW9uIChvcHRpb25zKSB7XG4gICAgICAgIHJldHVybiBnZXRTZXNzaW9uKG9wdGlvbnMpO1xuICAgIH1cbn0pO1xuXG5tb2R1bGUuZXhwb3J0cyA9IEF1dGhNYW5hZ2VyO1xuIiwiJ3VzZSBzdHJpY3QnO1xuXG52YXIgQ2hhbm5lbCA9IHJlcXVpcmUoJy4uL3NlcnZpY2UvY2hhbm5lbC1zZXJ2aWNlJyk7XG5cbi8qKlxuICogIyMgQ2hhbm5lbCBNYW5hZ2VyXG4gKlxuICogVGhlcmUgYXJlIHR3byBtYWluIHVzZSBjYXNlcyBmb3IgdGhlIGNoYW5uZWw6IGV2ZW50IG5vdGlmaWNhdGlvbnMgYW5kIGNoYXQgbWVzc2FnZXMuXG4gKlxuICogVGhlIENoYW5uZWwgTWFuYWdlciBpcyBhIHdyYXBwZXIgYXJvdW5kIHRoZSBkZWZhdWx0IFtjb21ldGQgSmF2YVNjcmlwdCBsaWJyYXJ5XShodHRwOi8vZG9jcy5jb21ldGQub3JnLzIvcmVmZXJlbmNlL2phdmFzY3JpcHQuaHRtbCksIGAkLmNvbWV0ZGAuIEl0IHByb3ZpZGVzIGEgZmV3IG5pY2UgZmVhdHVyZXMgdGhhdCBgJC5jb21ldGRgIGRvZXNuJ3QsIGluY2x1ZGluZzpcbiAqXG4gKiAqIEF1dG9tYXRpYyByZS1zdWJzY3JpcHRpb24gdG8gY2hhbm5lbHMgaWYgeW91IGxvc2UgeW91ciBjb25uZWN0aW9uXG4gKiAqIE9ubGluZSAvIE9mZmxpbmUgbm90aWZpY2F0aW9uc1xuICogKiAnRXZlbnRzJyBmb3IgY29tZXRkIG5vdGlmaWNhdGlvbnMgKGluc3RlYWQgb2YgaGF2aW5nIHRvIGxpc3RlbiBvbiBzcGVjaWZpYyBtZXRhIGNoYW5uZWxzKVxuICpcbiAqIFdoaWxlIHlvdSBjYW4gd29yayBkaXJlY3RseSB3aXRoIHRoZSBDaGFubmVsIE1hbmFnZXIgdGhyb3VnaCBOb2RlLmpzIChmb3IgZXhhbXBsZSwgYHJlcXVpcmUoJ21hbmFnZXIvY2hhbm5lbC1tYW5hZ2VyJylgKSAtLSBvciBldmVuIHdvcmsgZGlyZWN0bHkgd2l0aCBgJC5jb21ldGRgIGFuZCBFcGljZW50ZXIncyB1bmRlcmx5aW5nIFtQdXNoIENoYW5uZWwgQVBJXSguLi8uLi8uLi9yZXN0X2FwaXMvbXVsdGlwbGF5ZXIvY2hhbm5lbC8pIC0tIG1vc3Qgb2Z0ZW4gaXQgd2lsbCBiZSBlYXNpZXN0IHRvIHdvcmsgd2l0aCB0aGUgW0VwaWNlbnRlciBDaGFubmVsIE1hbmFnZXJdKC4uL2VwaWNlbnRlci1jaGFubmVsLW1hbmFnZXIvKS4gVGhlIEVwaWNlbnRlciBDaGFubmVsIE1hbmFnZXIgaXMgYSB3cmFwcGVyIHRoYXQgaW5zdGFudGlhdGVzIGEgQ2hhbm5lbCBNYW5hZ2VyIHdpdGggRXBpY2VudGVyLXNwZWNpZmljIGRlZmF1bHRzLlxuICpcbiAqIFlvdSdsbCBuZWVkIHRvIGluY2x1ZGUgdGhlIGBlcGljZW50ZXItbXVsdGlwbGF5ZXItZGVwZW5kZW5jaWVzLmpzYCBsaWJyYXJ5IGluIGFkZGl0aW9uIHRvIHRoZSBgZXBpY2VudGVyLmpzYCBsaWJyYXJ5IGluIHlvdXIgcHJvamVjdCB0byB1c2UgdGhlIENoYW5uZWwgTWFuYWdlci4gKFNlZSBbSW5jbHVkaW5nIEVwaWNlbnRlci5qc10oLi4vLi4vI2luY2x1ZGUpLilcbiAqXG4gKiBUbyB1c2UgdGhlIENoYW5uZWwgTWFuYWdlciBpbiBjbGllbnQtc2lkZSBKYXZhU2NyaXB0LCBpbnN0YW50aWF0ZSB0aGUgW0VwaWNlbnRlciBDaGFubmVsIE1hbmFnZXJdKC4uL2VwaWNlbnRlci1jaGFubmVsLW1hbmFnZXIvKSwgZ2V0IHRoZSBjaGFubmVsLCB0aGVuIHVzZSB0aGUgY2hhbm5lbCdzIGBzdWJzY3JpYmUoKWAgYW5kIGBwdWJsaXNoKClgIG1ldGhvZHMgdG8gc3Vic2NyaWJlIHRvIHRvcGljcyBvciBwdWJsaXNoIGRhdGEgdG8gdG9waWNzLlxuICpcbiAqICAgICAgICB2YXIgY20gPSBuZXcgRi5tYW5hZ2VyLkNoYW5uZWxNYW5hZ2VyKCk7XG4gKiAgICAgICAgdmFyIGNoYW5uZWwgPSBjbS5nZXRDaGFubmVsKCk7XG4gKiAgICAgICAgY2hhbm5lbC5zdWJzY3JpYmUodG9waWMpO1xuICpcbiAqIFRoZSBwYXJhbWV0ZXJzIGZvciBpbnN0YW50aWF0aW5nIGEgQ2hhbm5lbCBNYW5hZ2VyIGluY2x1ZGU6XG4gKlxuICogKiBgb3B0aW9uc2AgVGhlIG9wdGlvbnMgb2JqZWN0IHRvIGNvbmZpZ3VyZSB0aGUgQ2hhbm5lbCBNYW5hZ2VyLiBCZXNpZGVzIHRoZSBjb21tb24gb3B0aW9ucyBsaXN0ZWQgaGVyZSwgc2VlIGh0dHA6Ly9kb2NzLmNvbWV0ZC5vcmcvcmVmZXJlbmNlL2phdmFzY3JpcHQuaHRtbCBmb3Igb3RoZXIgc3VwcG9ydGVkIG9wdGlvbnMuXG4gKiAqIGBvcHRpb25zLnVybGAgVGhlIENvbWV0ZCBlbmRwb2ludCBVUkwuXG4gKiAqIGBvcHRpb25zLndlYnNvY2tldEVuYWJsZWRgIFdoZXRoZXIgd2Vic29ja2V0IHN1cHBvcnQgaXMgYWN0aXZlIChib29sZWFuKS5cbiAqICogYG9wdGlvbnMuY2hhbm5lbGAgT3RoZXIgZGVmYXVsdHMgdG8gcGFzcyBvbiB0byBpbnN0YW5jZXMgb2YgdGhlIHVuZGVybHlpbmcgQ2hhbm5lbCBTZXJ2aWNlLiBTZWUgW0NoYW5uZWwgU2VydmljZV0oLi4vY2hhbm5lbC1zZXJ2aWNlLykgZm9yIGRldGFpbHMuXG4gKlxuICovXG52YXIgQ2hhbm5lbE1hbmFnZXIgPSBmdW5jdGlvbiAob3B0aW9ucykge1xuICAgIGlmICghJC5jb21ldGQpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdDb21ldGQgbGlicmFyeSBub3QgZm91bmQuIFBsZWFzZSBpbmNsdWRlIGVwaWNlbnRlci1tdWx0aXBsYXllci1kZXBlbmRlbmNpZXMuanMnKTtcbiAgICB9XG4gICAgaWYgKCFvcHRpb25zIHx8ICFvcHRpb25zLnVybCkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ1BsZWFzZSBwcm92aWRlIGFuIHVybCBmb3IgdGhlIGNvbWV0ZCBzZXJ2ZXInKTtcbiAgICB9XG5cbiAgICB2YXIgY29tZXRkID0gbmV3ICQuQ29tZXRkKCk7XG5cbiAgICB2YXIgZGVmYXVsdHMgPSB7XG4gICAgICAgIC8qKlxuICAgICAgICAgKiBUaGUgQ29tZXRkIGVuZHBvaW50IFVSTC5cbiAgICAgICAgICovXG4gICAgICAgIHVybDogJycsXG5cbiAgICAgICAgLyoqXG4gICAgICAgICAqIFRoZSBsb2cgbGV2ZWwgZm9yIHRoZSBjaGFubmVsIChsb2dzIHRvIGNvbnNvbGUpLlxuICAgICAgICAgKi9cbiAgICAgICAgbG9nTGV2ZWw6ICdpbmZvJyxcblxuICAgICAgICAvKipcbiAgICAgICAgICogV2hldGhlciB3ZWJzb2NrZXQgc3VwcG9ydCBpcyBhY3RpdmUuIERlZmF1bHRzIHRvIGBmYWxzZWA7IEVwaWNlbnRlciBkb2Vzbid0IGN1cnJlbnRseSBjb21tdW5pY2F0aW9uIHRocm91Z2ggd2Vic29ja2V0cy5cbiAgICAgICAgICovXG4gICAgICAgIHdlYnNvY2tldEVuYWJsZWQ6IGZhbHNlLFxuXG4gICAgICAgIC8qKlxuICAgICAgICAgKiBPdGhlciBkZWZhdWx0cyB0byBwYXNzIG9uIHRvIGluc3RhbmNlcyBvZiB0aGUgdW5kZXJseWluZyBbQ2hhbm5lbCBTZXJ2aWNlXSguLi9jaGFubmVsLXNlcnZpY2UvKSwgd2hpY2ggYXJlIGNyZWF0ZWQgdGhyb3VnaCBgZ2V0Q2hhbm5lbCgpYC5cbiAgICAgICAgICovXG4gICAgICAgIGNoYW5uZWw6IHtcblxuICAgICAgICB9XG4gICAgfTtcbiAgICB2YXIgZGVmYXVsdENvbWV0T3B0aW9ucyA9ICQuZXh0ZW5kKHRydWUsIHt9LCBkZWZhdWx0cywgb3B0aW9ucyk7XG5cbiAgICBjb21ldGQud2Vic29ja2V0RW5hYmxlZCA9IGRlZmF1bHRDb21ldE9wdGlvbnMud2Vic29ja2V0RW5hYmxlZDtcblxuICAgIHRoaXMuaXNDb25uZWN0ZWQgPSBmYWxzZTtcbiAgICB0aGlzLmN1cnJlbnRTdWJzY3JpcHRpb25zID0gW107XG4gICAgdGhpcy5vcHRpb25zID0gZGVmYXVsdENvbWV0T3B0aW9ucztcblxuICAgIHZhciBjb25uZWN0aW9uQnJva2VuID0gZnVuY3Rpb24gKG1lc3NhZ2UpIHtcbiAgICAgICAgJCh0aGlzKS50cmlnZ2VyKCdkaXNjb25uZWN0JywgbWVzc2FnZSk7XG4gICAgfTtcbiAgICB2YXIgY29ubmVjdGlvblN1Y2NlZWRlZCA9IGZ1bmN0aW9uIChtZXNzYWdlKSB7XG4gICAgICAgICQodGhpcykudHJpZ2dlcignY29ubmVjdCcsIG1lc3NhZ2UpO1xuICAgIH07XG4gICAgdmFyIG1lID0gdGhpcztcblxuICAgIGNvbWV0ZC5jb25maWd1cmUoZGVmYXVsdENvbWV0T3B0aW9ucyk7XG5cbiAgICBjb21ldGQuYWRkTGlzdGVuZXIoJy9tZXRhL2Nvbm5lY3QnLCBmdW5jdGlvbiAobWVzc2FnZSkge1xuICAgICAgICB2YXIgd2FzQ29ubmVjdGVkID0gdGhpcy5pc0Nvbm5lY3RlZDtcbiAgICAgICAgdGhpcy5pc0Nvbm5lY3RlZCA9IChtZXNzYWdlLnN1Y2Nlc3NmdWwgPT09IHRydWUpO1xuICAgICAgICBpZiAoIXdhc0Nvbm5lY3RlZCAmJiB0aGlzLmlzQ29ubmVjdGVkKSB7IC8vQ29ubmVjdGluZyBmb3IgdGhlIGZpcnN0IHRpbWVcbiAgICAgICAgICAgIGNvbm5lY3Rpb25TdWNjZWVkZWQuY2FsbCh0aGlzLCBtZXNzYWdlKTtcbiAgICAgICAgfSBlbHNlIGlmICh3YXNDb25uZWN0ZWQgJiYgIXRoaXMuaXNDb25uZWN0ZWQpIHsgLy9Pbmx5IHRocm93IGRpc2Nvbm5lY3RlZCBtZXNzYWdlIGZybyB0aGUgZmlyc3QgZGlzY29ubmVjdCwgbm90IG9uY2UgcGVyIHRyeVxuICAgICAgICAgICAgY29ubmVjdGlvbkJyb2tlbi5jYWxsKHRoaXMsIG1lc3NhZ2UpO1xuICAgICAgICB9XG4gICAgfS5iaW5kKHRoaXMpKTtcblxuICAgIGNvbWV0ZC5hZGRMaXN0ZW5lcignL21ldGEvZGlzY29ubmVjdCcsIGNvbm5lY3Rpb25Ccm9rZW4pO1xuXG4gICAgY29tZXRkLmFkZExpc3RlbmVyKCcvbWV0YS9oYW5kc2hha2UnLCBmdW5jdGlvbiAobWVzc2FnZSkge1xuICAgICAgICBpZiAobWVzc2FnZS5zdWNjZXNzZnVsKSB7XG4gICAgICAgICAgICAvL2h0dHA6Ly9kb2NzLmNvbWV0ZC5vcmcvcmVmZXJlbmNlL2phdmFzY3JpcHRfc3Vic2NyaWJlLmh0bWwjamF2YXNjcmlwdF9zdWJzY3JpYmVfbWV0YV9jaGFubmVsc1xuICAgICAgICAgICAgLy8gXiBcImR5bmFtaWMgc3Vic2NyaXB0aW9ucyBhcmUgY2xlYXJlZCAobGlrZSBhbnkgb3RoZXIgc3Vic2NyaXB0aW9uKSBhbmQgdGhlIGFwcGxpY2F0aW9uIG5lZWRzIHRvIGZpZ3VyZSBvdXQgd2hpY2ggZHluYW1pYyBzdWJzY3JpcHRpb24gbXVzdCBiZSBwZXJmb3JtZWQgYWdhaW5cIlxuICAgICAgICAgICAgY29tZXRkLmJhdGNoKGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgICAgICAkKG1lLmN1cnJlbnRTdWJzY3JpcHRpb25zKS5lYWNoKGZ1bmN0aW9uIChpbmRleCwgc3Vicykge1xuICAgICAgICAgICAgICAgICAgICBjb21ldGQucmVzdWJzY3JpYmUoc3Vicyk7XG4gICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfVxuICAgIH0pO1xuXG4gICAgLy9PdGhlciBpbnRlcmVzdGluZyBldmVudHMgZm9yIHJlZmVyZW5jZVxuICAgIGNvbWV0ZC5hZGRMaXN0ZW5lcignL21ldGEvc3Vic2NyaWJlJywgZnVuY3Rpb24gKG1lc3NhZ2UpIHtcbiAgICAgICAgJChtZSkudHJpZ2dlcignc3Vic2NyaWJlJywgbWVzc2FnZSk7XG4gICAgfSk7XG4gICAgY29tZXRkLmFkZExpc3RlbmVyKCcvbWV0YS91bnN1YnNjcmliZScsIGZ1bmN0aW9uIChtZXNzYWdlKSB7XG4gICAgICAgICQobWUpLnRyaWdnZXIoJ3Vuc3Vic2NyaWJlJywgbWVzc2FnZSk7XG4gICAgfSk7XG4gICAgY29tZXRkLmFkZExpc3RlbmVyKCcvbWV0YS9wdWJsaXNoJywgZnVuY3Rpb24gKG1lc3NhZ2UpIHtcbiAgICAgICAgJChtZSkudHJpZ2dlcigncHVibGlzaCcsIG1lc3NhZ2UpO1xuICAgIH0pO1xuICAgIGNvbWV0ZC5hZGRMaXN0ZW5lcignL21ldGEvdW5zdWNjZXNzZnVsJywgZnVuY3Rpb24gKG1lc3NhZ2UpIHtcbiAgICAgICAgJChtZSkudHJpZ2dlcignZXJyb3InLCBtZXNzYWdlKTtcbiAgICB9KTtcblxuICAgIGNvbWV0ZC5oYW5kc2hha2UoKTtcblxuICAgIHRoaXMuY29tZXRkID0gY29tZXRkO1xufTtcblxuXG5DaGFubmVsTWFuYWdlci5wcm90b3R5cGUgPSAkLmV4dGVuZChDaGFubmVsTWFuYWdlci5wcm90b3R5cGUsIHtcblxuICAgIC8qKlxuICAgICAqIENyZWF0ZXMgYW5kIHJldHVybnMgYSBjaGFubmVsLCB0aGF0IGlzLCBhbiBpbnN0YW5jZSBvZiBhIFtDaGFubmVsIFNlcnZpY2VdKC4uL2NoYW5uZWwtc2VydmljZS8pLlxuICAgICAqXG4gICAgICogKipFeGFtcGxlKipcbiAgICAgKlxuICAgICAqICAgICAgdmFyIGNtID0gbmV3IEYubWFuYWdlci5DaGFubmVsTWFuYWdlcigpO1xuICAgICAqICAgICAgdmFyIGNoYW5uZWwgPSBjbS5nZXRDaGFubmVsKCk7XG4gICAgICogICAgICBjaGFubmVsLnN1YnNjcmliZSh0b3BpYyk7XG4gICAgICpcbiAgICAgKiAqKlBhcmFtZXRlcnMqKlxuICAgICAqIEBwYXJhbSB7Tm9uZX0gTm9uZVxuICAgICAqL1xuICAgIGdldENoYW5uZWw6IGZ1bmN0aW9uIChvcHRpb25zKSB7XG4gICAgICAgIC8vSWYgeW91IGp1c3Qgd2FudCB0byBwYXNzIGluIGEgc3RyaW5nXG4gICAgICAgIGlmIChvcHRpb25zICYmICEkLmlzUGxhaW5PYmplY3Qob3B0aW9ucykpIHtcbiAgICAgICAgICAgIG9wdGlvbnMgPSB7XG4gICAgICAgICAgICAgICAgYmFzZTogb3B0aW9uc1xuICAgICAgICAgICAgfTtcbiAgICAgICAgfVxuICAgICAgICB2YXIgZGVmYXVsdHMgPSB7XG4gICAgICAgICAgICB0cmFuc3BvcnQ6IHRoaXMuY29tZXRkXG4gICAgICAgIH07XG4gICAgICAgIHZhciBjaGFubmVsID0gbmV3IENoYW5uZWwoJC5leHRlbmQodHJ1ZSwge30sIHRoaXMub3B0aW9ucy5jaGFubmVsLCBkZWZhdWx0cywgb3B0aW9ucykpO1xuXG5cbiAgICAgICAgLy9XcmFwIHN1YnMgYW5kIHVuc3VicyBzbyB3ZSBjYW4gdXNlIGl0IHRvIHJlLWF0dGFjaCBoYW5kbGVycyBhZnRlciBiZWluZyBkaXNjb25uZWN0ZWRcbiAgICAgICAgdmFyIHN1YnMgPSBjaGFubmVsLnN1YnNjcmliZTtcbiAgICAgICAgY2hhbm5lbC5zdWJzY3JpYmUgPSBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICB2YXIgc3ViaWQgPSBzdWJzLmFwcGx5KGNoYW5uZWwsIGFyZ3VtZW50cyk7XG4gICAgICAgICAgICB0aGlzLmN1cnJlbnRTdWJzY3JpcHRpb25zICA9IHRoaXMuY3VycmVudFN1YnNjcmlwdGlvbnMuY29uY2F0KHN1YmlkKTtcbiAgICAgICAgICAgIHJldHVybiBzdWJpZDtcbiAgICAgICAgfS5iaW5kKHRoaXMpO1xuXG5cbiAgICAgICAgdmFyIHVuc3VicyA9IGNoYW5uZWwudW5zdWJzY3JpYmU7XG4gICAgICAgIGNoYW5uZWwudW5zdWJzY3JpYmUgPSBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICB2YXIgcmVtb3ZlZCA9IHVuc3Vicy5hcHBseShjaGFubmVsLCBhcmd1bWVudHMpO1xuICAgICAgICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCB0aGlzLmN1cnJlbnRTdWJzY3JpcHRpb25zLmxlbmd0aDsgaSsrKSB7XG4gICAgICAgICAgICAgICAgaWYgKHRoaXMuY3VycmVudFN1YnNjcmlwdGlvbnNbaV0uaWQgPT09IHJlbW92ZWQuaWQpIHtcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5jdXJyZW50U3Vic2NyaXB0aW9ucy5zcGxpY2UoaSwgMSk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgcmV0dXJuIHJlbW92ZWQ7XG4gICAgICAgIH0uYmluZCh0aGlzKTtcblxuICAgICAgICByZXR1cm4gY2hhbm5lbDtcbiAgICB9LFxuXG4gICAgLyoqXG4gICAgICogU3RhcnQgbGlzdGVuaW5nIGZvciBldmVudHMgb24gdGhpcyBpbnN0YW5jZS4gU2lnbmF0dXJlIGlzIHNhbWUgYXMgZm9yIGpRdWVyeSBFdmVudHM6IGh0dHA6Ly9hcGkuanF1ZXJ5LmNvbS9vbi8uXG4gICAgICpcbiAgICAgKiBTdXBwb3J0ZWQgZXZlbnRzIGFyZTogYGNvbm5lY3RgLCBgZGlzY29ubmVjdGAsIGBzdWJzY3JpYmVgLCBgdW5zdWJzY3JpYmVgLCBgcHVibGlzaGAsIGBlcnJvcmAuXG4gICAgICpcbiAgICAgKiAqKlBhcmFtZXRlcnMqKlxuICAgICAqXG4gICAgICogQHBhcmFtIHtzdHJpbmd9IGBldmVudGAgVGhlIGV2ZW50IHR5cGUuIFNlZSBtb3JlIGRldGFpbCBhdCBqUXVlcnkgRXZlbnRzOiBodHRwOi8vYXBpLmpxdWVyeS5jb20vb24vLlxuICAgICAqL1xuICAgIG9uOiBmdW5jdGlvbiAoKSB7XG4gICAgICAgICQodGhpcykub24uYXBwbHkoJCh0aGlzKSwgYXJndW1lbnRzKTtcbiAgICB9LFxuXG4gICAgLyoqXG4gICAgICogU3RvcCBsaXN0ZW5pbmcgZm9yIGV2ZW50cyBvbiB0aGlzIGluc3RhbmNlLiBTaWduYXR1cmUgaXMgc2FtZSBhcyBmb3IgalF1ZXJ5IEV2ZW50czogaHR0cDovL2FwaS5qcXVlcnkuY29tL29mZi8uXG4gICAgICpcbiAgICAgKiAqKlBhcmFtZXRlcnMqKlxuICAgICAqXG4gICAgICogQHBhcmFtIHtzdHJpbmd9IGBldmVudGAgVGhlIGV2ZW50IHR5cGUuIFNlZSBtb3JlIGRldGFpbCBhdCBqUXVlcnkgRXZlbnRzOiBodHRwOi8vYXBpLmpxdWVyeS5jb20vb2ZmLy5cbiAgICAgKi9cbiAgICBvZmY6IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgJCh0aGlzKS5vZmYuYXBwbHkoJCh0aGlzKSwgYXJndW1lbnRzKTtcbiAgICB9LFxuXG4gICAgLyoqXG4gICAgICogVHJpZ2dlciBldmVudHMgYW5kIGV4ZWN1dGUgaGFuZGxlcnMuIFNpZ25hdHVyZSBpcyBzYW1lIGFzIGZvciBqUXVlcnkgRXZlbnRzOiBodHRwOi8vYXBpLmpxdWVyeS5jb20vdHJpZ2dlci8uXG4gICAgICpcbiAgICAgKiAqKlBhcmFtZXRlcnMqKlxuICAgICAqXG4gICAgICogQHBhcmFtIHtzdHJpbmd9IGBldmVudGAgVGhlIGV2ZW50IHR5cGUuIFNlZSBtb3JlIGRldGFpbCBhdCBqUXVlcnkgRXZlbnRzOiBodHRwOi8vYXBpLmpxdWVyeS5jb20vdHJpZ2dlci8uXG4gICAgICovXG4gICAgdHJpZ2dlcjogZnVuY3Rpb24gKCkge1xuICAgICAgICAkKHRoaXMpLnRyaWdnZXIuYXBwbHkoJCh0aGlzKSwgYXJndW1lbnRzKTtcbiAgICB9XG59KTtcblxubW9kdWxlLmV4cG9ydHMgPSBDaGFubmVsTWFuYWdlcjtcbiIsIid1c2Ugc3RyaWN0JztcblxuLyoqXG4gKiAjIyBFcGljZW50ZXIgQ2hhbm5lbCBNYW5hZ2VyXG4gKlxuICogVGhlIEVwaWNlbnRlciBwbGF0Zm9ybSBwcm92aWRlcyBhIHB1c2ggY2hhbm5lbCwgd2hpY2ggYWxsb3dzIHlvdSB0byBwdWJsaXNoIGFuZCBzdWJzY3JpYmUgdG8gbWVzc2FnZXMgd2l0aGluIGEgW3Byb2plY3RdKC4uLy4uLy4uL2dsb3NzYXJ5LyNwcm9qZWN0cyksIFtncm91cF0oLi4vLi4vLi4vZ2xvc3NhcnkvI2dyb3VwcyksIG9yIFttdWx0aXBsYXllciB3b3JsZF0oLi4vLi4vLi4vZ2xvc3NhcnkvI3dvcmxkKS4gVGhlcmUgYXJlIHR3byBtYWluIHVzZSBjYXNlcyBmb3IgdGhlIGNoYW5uZWw6IGV2ZW50IG5vdGlmaWNhdGlvbnMgYW5kIGNoYXQgbWVzc2FnZXMuXG4gKlxuICogVGhlIEVwaWNlbnRlciBDaGFubmVsIE1hbmFnZXIgaXMgYSB3cmFwcGVyIGFyb3VuZCB0aGUgKG1vcmUgZ2VuZXJpYykgW0NoYW5uZWwgTWFuYWdlcl0oLi4vY2hhbm5lbC1tYW5hZ2VyLyksIHRvIGluc3RhbnRpYXRlIGl0IHdpdGggRXBpY2VudGVyLXNwZWNpZmljIGRlZmF1bHRzLiBJZiB5b3UgYXJlIGludGVyZXN0ZWQgaW4gaW5jbHVkaW5nIGEgbm90aWZpY2F0aW9uIG9yIGNoYXQgZmVhdHVyZSBpbiB5b3VyIHByb2plY3QsIHVzaW5nIGFuIEVwaWNlbnRlciBDaGFubmVsIE1hbmFnZXIgaXMgcHJvYmFibHkgdGhlIGVhc2llc3Qgd2F5IHRvIGdldCBzdGFydGVkLlxuICpcbiAqIFlvdSdsbCBuZWVkIHRvIGluY2x1ZGUgdGhlIGBlcGljZW50ZXItbXVsdGlwbGF5ZXItZGVwZW5kZW5jaWVzLmpzYCBsaWJyYXJ5IGluIGFkZGl0aW9uIHRvIHRoZSBgZXBpY2VudGVyLmpzYCBsaWJyYXJ5IGluIHlvdXIgcHJvamVjdCB0byB1c2UgdGhlIEVwaWNlbnRlciBDaGFubmVsIE1hbmFnZXIuIChTZWUgW0luY2x1ZGluZyBFcGljZW50ZXIuanNdKC4uLy4uLyNpbmNsdWRlKS4pXG4gKlxuICogVG8gdXNlIHRoZSBFcGljZW50ZXIgQ2hhbm5lbCBNYW5hZ2VyOiBpbnN0YW50aWF0ZSBpdCwgZ2V0IHRoZSBjaGFubmVsIG9mIHRoZSBzY29wZSB5b3Ugd2FudCAoW3VzZXJdKC4uLy4uLy4uL2dsb3NzYXJ5LyN1c2VycyksIFt3b3JsZF0oLi4vLi4vLi4vZ2xvc3NhcnkvI3dvcmxkKSwgb3IgW2dyb3VwXSguLi8uLi8uLi9nbG9zc2FyeS8jZ3JvdXBzKSksIHRoZW4gdXNlIHRoZSBjaGFubmVsJ3MgYHN1YnNjcmliZSgpYCBhbmQgYHB1Ymxpc2goKWAgbWV0aG9kcyB0byBzdWJzY3JpYmUgdG8gdG9waWNzIG9yIHB1Ymxpc2ggZGF0YSB0byB0b3BpY3MuXG4gKlxuICogICAgIHZhciBjbSA9IG5ldyBGLm1hbmFnZXIuQ2hhbm5lbE1hbmFnZXIoKTtcbiAqICAgICB2YXIgZ2MgPSBjbS5nZXRHcm91cENoYW5uZWwoKTtcbiAqICAgICBnYy5zdWJzY3JpYmUoJ2Jyb2FkY2FzdHMnLCBjYWxsYmFjayk7XG4gKlxuICogRm9yIGFkZGl0aW9uYWwgYmFja2dyb3VuZCBvbiBFcGljZW50ZXIncyBwdXNoIGNoYW5uZWwsIHNlZSB0aGUgaW50cm9kdWN0b3J5IG5vdGVzIG9uIHRoZSBbUHVzaCBDaGFubmVsIEFQSV0oLi4vLi4vLi4vcmVzdF9hcGlzL211bHRpcGxheWVyL2NoYW5uZWwvKSBwYWdlLlxuICpcbiAqIFRoZSBwYXJhbWV0ZXJzIGZvciBpbnN0YW50aWF0aW5nIGFuIEVwaWNlbnRlciBDaGFubmVsIE1hbmFnZXIgaW5jbHVkZTpcbiAqXG4gKiAqIGBzZXJ2ZXJgIE9iamVjdCB3aXRoIGRldGFpbHMgYWJvdXQgdGhlIEVwaWNlbnRlciBwcm9qZWN0IGZvciB0aGlzIEVwaWNlbnRlciBDaGFubmVsIE1hbmFnZXIgaW5zdGFuY2UuXG4gKiAqIGBzZXJ2ZXIuYWNjb3VudGAgVGhlIEVwaWNlbnRlciBhY2NvdW50IGlkICgqKlRlYW0gSUQqKiBmb3IgdGVhbSBwcm9qZWN0cywgKipVc2VyIElEKiogZm9yIHBlcnNvbmFsIHByb2plY3RzKS5cbiAqICogYHNlcnZlci5wcm9qZWN0YCBFcGljZW50ZXIgcHJvamVjdCBpZC5cbiAqL1xuXG52YXIgQ2hhbm5lbE1hbmFnZXIgPSByZXF1aXJlKCcuL2NoYW5uZWwtbWFuYWdlcicpO1xudmFyIGNsYXNzRnJvbSA9IHJlcXVpcmUoJy4uL3V0aWwvaW5oZXJpdCcpO1xudmFyIHVybFNlcnZpY2UgPSByZXF1aXJlKCcuLi9zZXJ2aWNlL3VybC1jb25maWctc2VydmljZScpO1xuXG52YXIgQXV0aE1hbmFnZXIgPSByZXF1aXJlKCcuL2F1dGgtbWFuYWdlcicpO1xuXG52YXIgc2Vzc2lvbiA9IG5ldyBBdXRoTWFuYWdlcigpO1xudmFyIGdldEZyb21TZXNzaW9uT3JFcnJvciA9IGZ1bmN0aW9uICh2YWx1ZSwgc2Vzc2lvbktleU5hbWUpIHtcbiAgICBpZiAoIXZhbHVlKSB7XG4gICAgICAgIHZhciB1c2VySW5mbyA9IHNlc3Npb24uZ2V0Q3VycmVudFVzZXJTZXNzaW9uSW5mbygpO1xuICAgICAgICBpZiAodXNlckluZm9bc2Vzc2lvbktleU5hbWVdKSB7XG4gICAgICAgICAgICB2YWx1ZSA9IHVzZXJJbmZvW3Nlc3Npb25LZXlOYW1lXTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihzZXNzaW9uS2V5TmFtZSArICcgbm90IGZvdW5kLiBQbGVhc2UgbG9nLWluIGFnYWluLCBvciBzcGVjaWZ5ICcgKyBzZXNzaW9uS2V5TmFtZSArICcgZXhwbGljaXRseScpO1xuICAgICAgICB9XG4gICAgfVxuICAgIHJldHVybiB2YWx1ZTtcbn07XG52YXIgX19zdXBlciA9IENoYW5uZWxNYW5hZ2VyLnByb3RvdHlwZTtcbnZhciBFcGljZW50ZXJDaGFubmVsTWFuYWdlciA9IGNsYXNzRnJvbShDaGFubmVsTWFuYWdlciwge1xuICAgIGNvbnN0cnVjdG9yOiBmdW5jdGlvbiAob3B0aW9ucykge1xuICAgICAgICB2YXIgdXNlckluZm8gPSBzZXNzaW9uLmdldEN1cnJlbnRVc2VyU2Vzc2lvbkluZm8oKTtcblxuICAgICAgICB2YXIgZGVmYXVsdHMgPSB7XG4gICAgICAgICAgICAvL1NlZSBkb2NzIGZvciB1cmwgY29uZmlnIHNlcnZpY2VcbiAgICAgICAgICAgIHNlcnZlcjoge1xuICAgICAgICAgICAgICAgIGFjY291bnQ6IHVzZXJJbmZvLmFjY291bnQsXG4gICAgICAgICAgICAgICAgcHJvamVjdDogdXNlckluZm8ucHJvamVjdFxuICAgICAgICAgICAgfVxuICAgICAgICB9O1xuICAgICAgICB2YXIgZGVmYXVsdENvbWV0T3B0aW9ucyA9ICQuZXh0ZW5kKHRydWUsIHt9LCBkZWZhdWx0cywgdXNlckluZm8sIG9wdGlvbnMpO1xuXG4gICAgICAgIHZhciB1cmxPcHRzID0gdXJsU2VydmljZShkZWZhdWx0Q29tZXRPcHRpb25zLnNlcnZlcik7XG4gICAgICAgIGlmICghZGVmYXVsdENvbWV0T3B0aW9ucy51cmwpIHtcbiAgICAgICAgICAgIC8vRGVmYXVsdCBlcGljZW50ZXIgY29tZXRkIGVuZHBvaW50XG4gICAgICAgICAgICBkZWZhdWx0Q29tZXRPcHRpb25zLnVybCA9IHVybE9wdHMucHJvdG9jb2wgKyAnOi8vJyArIHVybE9wdHMuaG9zdCArICcvY2hhbm5lbC9zdWJzY3JpYmUnO1xuICAgICAgICB9XG5cbiAgICAgICAgdGhpcy5vcHRpb25zID0gZGVmYXVsdENvbWV0T3B0aW9ucztcbiAgICAgICAgcmV0dXJuIF9fc3VwZXIuY29uc3RydWN0b3IuY2FsbCh0aGlzLCBkZWZhdWx0Q29tZXRPcHRpb25zKTtcbiAgICB9LFxuXG4gICAgLyoqXG4gICAgICogQ3JlYXRlIGFuZCByZXR1cm4gYSBwdWJsaXNoL3N1YnNjcmliZSBjaGFubmVsIChmcm9tIHRoZSB1bmRlcmx5aW5nIFtDaGFubmVsIE1hbmFnZXJdKC4uL2NoYW5uZWwtbWFuYWdlci8pKSBmb3IgdGhlIGdpdmVuIFtncm91cF0oLi4vLi4vLi4vZ2xvc3NhcnkvI2dyb3VwcykuIFRoZSBncm91cCBtdXN0IGJlIG9uZSBvZiB0aGUgZ3JvdXBzIGluIHRoaXMgYWNjb3VudCAodGVhbSkgYW5kIHByb2plY3QuXG4gICAgICpcbiAgICAgKiBUaGVyZSBhcmUgbm8gbm90aWZpY2F0aW9ucyBmcm9tIEVwaWNlbnRlciBvbiB0aGlzIGNoYW5uZWw7IGFsbCBtZXNzYWdlcyBhcmUgdXNlci1vcmdpbmF0ZWQuXG4gICAgICpcbiAgICAgKiAqKkV4YW1wbGUqKlxuICAgICAqXG4gICAgICogICAgIHZhciBjbSA9IG5ldyBGLm1hbmFnZXIuQ2hhbm5lbE1hbmFnZXIoKTtcbiAgICAgKiAgICAgdmFyIGdjID0gY20uZ2V0R3JvdXBDaGFubmVsKCk7XG4gICAgICogICAgIGdjLnN1YnNjcmliZSgnYnJvYWRjYXN0cycsIGNhbGxiYWNrKTtcbiAgICAgKlxuICAgICAqICoqUmV0dXJuIFZhbHVlKipcbiAgICAgKlxuICAgICAqICogKkNoYW5uZWwqIFJldHVybnMgdGhlIGNoYW5uZWwgKGFuIGluc3RhbmNlIG9mIHRoZSBbQ2hhbm5lbCBTZXJ2aWNlXSguLi9jaGFubmVsLXNlcnZpY2UvKSkuXG4gICAgICpcbiAgICAgKiAqKlBhcmFtZXRlcnMqKlxuICAgICAqXG4gICAgICogQHBhcmFtICB7U3RyaW5nfSBgZ3JvdXBOYW1lYCAoT3B0aW9uYWwpIEdyb3VwIHRvIGJyb2FkY2FzdCB0by4gSWYgbm90IHByb3ZpZGVkLCBwaWNrcyB1cCBncm91cCBmcm9tIGN1cnJlbnQgc2Vzc2lvbiBpZiBlbmQgdXNlciBpcyBsb2dnZWQgaW4uXG4gICAgICovXG4gICAgZ2V0R3JvdXBDaGFubmVsOiBmdW5jdGlvbiAoZ3JvdXBOYW1lKSB7XG4gICAgICAgIGdyb3VwTmFtZSA9IGdldEZyb21TZXNzaW9uT3JFcnJvcihncm91cE5hbWUsICdncm91cE5hbWUnKTtcbiAgICAgICAgdmFyIGJhc2VUb3BpYyA9IFsnL2dyb3VwJywgdGhpcy5vcHRpb25zLnNlcnZlci5hY2NvdW50LCB0aGlzLm9wdGlvbnMuc2VydmVyLnByb2plY3QsIGdyb3VwTmFtZV0uam9pbignLycpO1xuICAgICAgICByZXR1cm4gX19zdXBlci5nZXRDaGFubmVsLmNhbGwodGhpcywgeyBiYXNlOiBiYXNlVG9waWMgfSk7XG4gICAgfSxcblxuICAgIC8qKlxuICAgICAqIENyZWF0ZSBhbmQgcmV0dXJuIGEgcHVibGlzaC9zdWJzY3JpYmUgY2hhbm5lbCAoZnJvbSB0aGUgdW5kZXJseWluZyBbQ2hhbm5lbCBNYW5hZ2VyXSguLi9jaGFubmVsLW1hbmFnZXIvKSkgZm9yIHRoZSBnaXZlbiBbd29ybGRdKC4uLy4uLy4uL2dsb3NzYXJ5LyN3b3JsZCkuXG4gICAgICpcbiAgICAgKiBUaGlzIGlzIHR5cGljYWxseSB1c2VkIHRvZ2V0aGVyIHdpdGggdGhlIFtXb3JsZCBNYW5hZ2VyXSguLi93b3JsZC1tYW5hZ2VyKS5cbiAgICAgKlxuICAgICAqICoqRXhhbXBsZSoqXG4gICAgICpcbiAgICAgKiAgICAgdmFyIGNtID0gbmV3IEYubWFuYWdlci5DaGFubmVsTWFuYWdlcigpO1xuICAgICAqICAgICB2YXIgd29ybGRNYW5hZ2VyID0gbmV3IEYubWFuYWdlci5Xb3JsZE1hbmFnZXIoe1xuICAgICAqICAgICAgICAgYWNjb3VudDogJ2FjbWUtc2ltdWxhdGlvbnMnLFxuICAgICAqICAgICAgICAgcHJvamVjdDogJ3N1cHBseS1jaGFpbi1nYW1lJyxcbiAgICAgKiAgICAgICAgIG1vZGVsOiAnbW9kZWwuZXFuJ1xuICAgICAqICAgICB9KTtcbiAgICAgKiAgICAgd29ybGRNYW5hZ2VyLmdldEN1cnJlbnRXb3JsZCgpLnRoZW4oZnVuY3Rpb24gKHdvcmxkT2JqZWN0LCB3b3JsZFNlcnZpY2UpIHtcbiAgICAgKiAgICAgICAgIHZhciB3b3JsZENoYW5uZWwgPSBjbS5nZXRXb3JsZENoYW5uZWwod29ybGRPYmplY3QpO1xuICAgICAqICAgICAgICAgd29ybGRDaGFubmVsLnN1YnNjcmliZSgnJywgZnVuY3Rpb24gKGRhdGEpIHtcbiAgICAgKiAgICAgICAgICAgICBjb25zb2xlLmxvZyhkYXRhKTtcbiAgICAgKiAgICAgICAgIH0pO1xuICAgICAqICAgICAgfSk7XG4gICAgICpcbiAgICAgKiAqKlJldHVybiBWYWx1ZSoqXG4gICAgICpcbiAgICAgKiAqICpDaGFubmVsKiBSZXR1cm5zIHRoZSBjaGFubmVsIChhbiBpbnN0YW5jZSBvZiB0aGUgW0NoYW5uZWwgU2VydmljZV0oLi4vY2hhbm5lbC1zZXJ2aWNlLykpLlxuICAgICAqXG4gICAgICogKipQYXJhbWV0ZXJzKipcbiAgICAgKlxuICAgICAqIEBwYXJhbSAge1N0cmluZ3xPYmplY3R9IGB3b3JsZGAgVGhlIHdvcmxkIG9iamVjdCBvciBpZC5cbiAgICAgKiBAcGFyYW0gIHtTdHJpbmd9IGBncm91cE5hbWVgIChPcHRpb25hbCkgR3JvdXAgdGhlIHdvcmxkIGV4aXN0cyBpbi4gSWYgbm90IHByb3ZpZGVkLCBwaWNrcyB1cCBncm91cCBmcm9tIGN1cnJlbnQgc2Vzc2lvbiBpZiBlbmQgdXNlciBpcyBsb2dnZWQgaW4uXG4gICAgICovXG4gICAgZ2V0V29ybGRDaGFubmVsOiBmdW5jdGlvbiAod29ybGQsIGdyb3VwTmFtZSkge1xuICAgICAgICB2YXIgd29ybGRpZCA9ICgkLmlzUGxhaW5PYmplY3Qod29ybGQpICYmIHdvcmxkLmlkKSA/IHdvcmxkLmlkIDogd29ybGQ7XG4gICAgICAgIGlmICghd29ybGRpZCkge1xuICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdQbGVhc2Ugc3BlY2lmeSBhIHdvcmxkIGlkJyk7XG4gICAgICAgIH1cbiAgICAgICAgZ3JvdXBOYW1lID0gZ2V0RnJvbVNlc3Npb25PckVycm9yKGdyb3VwTmFtZSwgJ2dyb3VwTmFtZScpO1xuICAgICAgICB2YXIgYmFzZVRvcGljID0gWycvd29ybGQnLCB0aGlzLm9wdGlvbnMuc2VydmVyLmFjY291bnQsIHRoaXMub3B0aW9ucy5zZXJ2ZXIucHJvamVjdCwgZ3JvdXBOYW1lLCB3b3JsZGlkXS5qb2luKCcvJyk7XG4gICAgICAgIHJldHVybiBfX3N1cGVyLmdldENoYW5uZWwuY2FsbCh0aGlzLCB7IGJhc2U6IGJhc2VUb3BpYyB9KTtcbiAgICB9LFxuXG4gICAgLyoqXG4gICAgICogQ3JlYXRlIGFuZCByZXR1cm4gYSBwdWJsaXNoL3N1YnNjcmliZSBjaGFubmVsIChmcm9tIHRoZSB1bmRlcmx5aW5nIFtDaGFubmVsIE1hbmFnZXJdKC4uL2NoYW5uZWwtbWFuYWdlci8pKSBmb3IgdGhlIGN1cnJlbnQgW2VuZCB1c2VyXSguLi8uLi8uLi9nbG9zc2FyeS8jdXNlcikgaW4gdGhhdCB1c2VyJ3MgY3VycmVudCBbd29ybGRdKC4uLy4uLy4uL2dsb3NzYXJ5LyN3b3JsZCkuXG4gICAgICpcbiAgICAgKiBUaGlzIGlzIHR5cGljYWxseSB1c2VkIHRvZ2V0aGVyIHdpdGggdGhlIFtXb3JsZCBNYW5hZ2VyXSguLi93b3JsZC1tYW5hZ2VyKS4gTm90ZSB0aGF0IHRoaXMgY2hhbm5lbCBvbmx5IGdldHMgbm90aWZpY2F0aW9ucyBmb3Igd29ybGRzIGN1cnJlbnRseSBpbiBtZW1vcnkuIChTZWUgbW9yZSBiYWNrZ3JvdW5kIG9uIFtwZXJzaXN0ZW5jZV0oLi4vLi4vLi4vcnVuX3BlcnNpc3RlbmNlKS4pXG4gICAgICpcbiAgICAgKiAqKkV4YW1wbGUqKlxuICAgICAqXG4gICAgICogICAgIHZhciBjbSA9IG5ldyBGLm1hbmFnZXIuQ2hhbm5lbE1hbmFnZXIoKTtcbiAgICAgKiAgICAgdmFyIHdvcmxkTWFuYWdlciA9IG5ldyBGLm1hbmFnZXIuV29ybGRNYW5hZ2VyKHtcbiAgICAgKiAgICAgICAgIGFjY291bnQ6ICdhY21lLXNpbXVsYXRpb25zJyxcbiAgICAgKiAgICAgICAgIHByb2plY3Q6ICdzdXBwbHktY2hhaW4tZ2FtZScsXG4gICAgICogICAgICAgICBtb2RlbDogJ21vZGVsLmVxbidcbiAgICAgKiAgICAgfSk7XG4gICAgICogICAgIHdvcmxkTWFuYWdlci5nZXRDdXJyZW50V29ybGQoKS50aGVuKGZ1bmN0aW9uICh3b3JsZE9iamVjdCwgd29ybGRTZXJ2aWNlKSB7XG4gICAgICogICAgICAgICB2YXIgdXNlckNoYW5uZWwgPSBjbS5nZXRVc2VyQ2hhbm5lbCh3b3JsZE9iamVjdCk7XG4gICAgICogICAgICAgICB1c2VyQ2hhbm5lbC5zdWJzY3JpYmUoJycsIGZ1bmN0aW9uIChkYXRhKSB7XG4gICAgICogICAgICAgICAgICAgY29uc29sZS5sb2coZGF0YSk7XG4gICAgICogICAgICAgICB9KTtcbiAgICAgKiAgICAgIH0pO1xuICAgICAqXG4gICAgICpcbiAgICAgKiAqKlJldHVybiBWYWx1ZSoqXG4gICAgICpcbiAgICAgKiAqICpDaGFubmVsKiBSZXR1cm5zIHRoZSBjaGFubmVsIChhbiBpbnN0YW5jZSBvZiB0aGUgW0NoYW5uZWwgU2VydmljZV0oLi4vY2hhbm5lbC1zZXJ2aWNlLykpLlxuICAgICAqXG4gICAgICogKipQYXJhbWV0ZXJzKipcbiAgICAgKlxuICAgICAqIEBwYXJhbSAge1N0cmluZ3xPYmplY3R9IGB3b3JsZGAgV29ybGQgb2JqZWN0IG9yIGlkLlxuICAgICAqIEBwYXJhbSAge1N0cmluZ3xPYmplY3R9IGB1c2VyYCAoT3B0aW9uYWwpIFVzZXIgb2JqZWN0IG9yIGlkLiBJZiBub3QgcHJvdmlkZWQsIHBpY2tzIHVwIHNlciBpZCBmcm9tIGN1cnJlbnQgc2Vzc2lvbiBpZiBlbmQgdXNlciBpcyBsb2dnZWQgaW4uXG4gICAgICogQHBhcmFtICB7U3RyaW5nfSBgZ3JvdXBOYW1lYCAoT3B0aW9uYWwpIEdyb3VwIHRoZSB3b3JsZCBleGlzdHMgaW4uIElmIG5vdCBwcm92aWRlZCwgcGlja3MgdXAgZ3JvdXAgZnJvbSBjdXJyZW50IHNlc3Npb24gaWYgZW5kIHVzZXIgaXMgbG9nZ2VkIGluLlxuICAgICAqL1xuICAgIGdldFVzZXJDaGFubmVsOiBmdW5jdGlvbiAod29ybGQsIHVzZXIsIGdyb3VwTmFtZSkge1xuICAgICAgICB2YXIgdXNlcmlkID0gKCQuaXNQbGFpbk9iamVjdCh1c2VyKSAmJiB1c2VyLmlkKSA/IHVzZXIuaWQgOiB1c2VyO1xuICAgICAgICB2YXIgd29ybGRpZCA9ICgkLmlzUGxhaW5PYmplY3Qod29ybGQpICYmIHdvcmxkLmlkKSA/IHdvcmxkLmlkIDogd29ybGQ7XG4gICAgICAgIGlmICghd29ybGRpZCkge1xuICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdQbGVhc2Ugc3BlY2lmeSBhIHdvcmxkIGlkJyk7XG4gICAgICAgIH1cbiAgICAgICAgdXNlcmlkID0gZ2V0RnJvbVNlc3Npb25PckVycm9yKHVzZXJpZCwgJ3VzZXJJZCcpO1xuICAgICAgICBncm91cE5hbWUgPSBnZXRGcm9tU2Vzc2lvbk9yRXJyb3IoZ3JvdXBOYW1lLCAnZ3JvdXBOYW1lJyk7XG5cbiAgICAgICAgdmFyIGJhc2VUb3BpYyA9IFsnL3VzZXJzJywgdGhpcy5vcHRpb25zLnNlcnZlci5hY2NvdW50LCB0aGlzLm9wdGlvbnMuc2VydmVyLnByb2plY3QsIGdyb3VwTmFtZSwgd29ybGRpZCwgdXNlcmlkXS5qb2luKCcvJyk7XG4gICAgICAgIHJldHVybiBfX3N1cGVyLmdldENoYW5uZWwuY2FsbCh0aGlzLCB7IGJhc2U6IGJhc2VUb3BpYyB9KTtcbiAgICB9XG59KTtcblxubW9kdWxlLmV4cG9ydHMgPSBFcGljZW50ZXJDaGFubmVsTWFuYWdlcjtcbiIsIid1c2Ugc3RyaWN0JztcblxubW9kdWxlLmV4cG9ydHMgPSB7XG4gICAgRVBJX0NPT0tJRV9LRVk6ICdlcGljZW50ZXIucHJvamVjdC50b2tlbicsXG4gICAgRVBJX1NFU1NJT05fS0VZOiAnZXBpY2VudGVyLnVzZXIuc2Vzc2lvbicsXG4gICAgU1RSQVRFR1lfU0VTU0lPTl9LRVk6ICdlcGljZW50ZXItc2NlbmFyaW8nXG59OyIsIi8qKlxuKiAjIyBSdW4gTWFuYWdlclxuKlxuKiBUaGUgUnVuIE1hbmFnZXIgZ2l2ZXMgeW91IGNvbnRyb2wgb3ZlciBydW4gY3JlYXRpb24gZGVwZW5kaW5nIG9uIHJ1biBzdGF0ZXMuIFNwZWNpZmljYWxseSwgeW91IGNhbiBzZWxlY3QgcnVuIGNyZWF0aW9uIHN0cmF0ZWdpZXMgKHJ1bGVzKSBmb3Igd2hpY2ggcnVucyBlbmQgdXNlcnMgb2YgeW91ciBwcm9qZWN0IHdvcmsgd2l0aCB3aGVuIHRoZXkgbG9nIGluIHRvIHlvdXIgcHJvamVjdC5cbipcbiogVW5kZXJseWluZyBFcGljZW50ZXIgQVBJcyAtLSBpbmNsdWRpbmcgdGhlIFtNb2RlbCBSdW4gQVBJXSguLi8uLi8uLi9yZXN0X2FwaXMvb3RoZXJfYXBpcy9tb2RlbF9hcGlzL3J1bi8pLCB0aGUgW1J1biBBUEldKC4uLy4uLy4uL3Jlc3RfYXBpcy9hZ2dyZWdhdGVfcnVuX2FwaSksIGFuZCBFcGljZW50ZXIuanMncyBvd24gW0Yuc2VydmljZS5SdW4uY3JlYXRlKCldKC4uL3J1bi1hcGktc2VydmljZS8pIC0tIGFsbCBhbGxvdyB5b3UgdG8gY3JlYXRlIG5ldyBydW5zLiBIb3dldmVyLCBmb3Igc29tZSBwcm9qZWN0cyBpdCBtYWtlcyBtb3JlIHNlbnNlIHRvIHBpY2sgdXAgd2hlcmUgdGhlIHVzZXIgbGVmdCBvZmYsIHVzaW5nIGFuIGV4aXN0aW5nIHJ1bi4gQW5kIGluIHNvbWUgcHJvamVjdHMsIHdoZXRoZXIgdG8gY3JlYXRlIGEgbmV3IG9uZSBvciB1c2UgYW4gZXhpc3Rpbmcgb25lIGlzIGNvbmRpdGlvbmFsLCBmb3IgZXhhbXBsZSBiYXNlZCBvbiBjaGFyYWN0ZXJpc3RpY3Mgb2YgdGhlIGV4aXN0aW5nIHJ1biBvciB5b3VyIG93biBrbm93bGVkZ2UgYWJvdXQgdGhlIG1vZGVsLiBUaGUgUnVuIE1hbmFnZXIgcHJvdmlkZXMgdGhpcyBsZXZlbCBvZiBjb250cm9sLlxuKlxuKiAjIyMgVXNpbmcgdGhlIFJ1biBNYW5hZ2VyIHRvIGNyZWF0ZSBhbmQgYWNjZXNzIHJ1bnNcbipcbiogVG8gdXNlIHRoZSBSdW4gTWFuYWdlciwgaW5zdGFudGlhdGUgaXQgYnkgcGFzc2luZyBpbjpcbipcbiogICAqIGBydW5gOiAocmVxdWlyZWQpIFJ1biBvYmplY3QuIE11c3QgY29udGFpbjpcbiogICAgICAgKiBgYWNjb3VudGA6IEVwaWNlbnRlciBhY2NvdW50IGlkICgqKlRlYW0gSUQqKiBmb3IgdGVhbSBwcm9qZWN0cywgKipVc2VyIElEKiogZm9yIHBlcnNvbmFsIHByb2plY3RzKS5cbiogICAgICAgKiBgcHJvamVjdGA6IEVwaWNlbnRlciBwcm9qZWN0IGlkLlxuKiAgICAgICAqIGBtb2RlbGA6IFRoZSBuYW1lIG9mIHlvdXIgcHJpbWFyeSBtb2RlbCBmaWxlLiAoU2VlIG1vcmUgb24gW1dyaXRpbmcgeW91ciBNb2RlbF0oLi4vLi4vLi4vd3JpdGluZ195b3VyX21vZGVsLykuKVxuKiAgICAgICAqIGBzY29wZWA6IChvcHRpb25hbCkgU2NvcGUgb2JqZWN0IGZvciB0aGUgcnVuLCBmb3IgZXhhbXBsZSBgc2NvcGUuZ3JvdXBgIHdpdGggdmFsdWUgb2YgdGhlIG5hbWUgb2YgdGhlIGdyb3VwLlxuKiAgICAgICAqIGBmaWxlc2A6IChvcHRpb25hbCkgSWYgYW5kIG9ubHkgaWYgeW91IGFyZSB1c2luZyBhIFZlbnNpbSBtb2RlbCBhbmQgeW91IGhhdmUgYWRkaXRpb25hbCBkYXRhIHRvIHBhc3MgaW4gdG8geW91ciBtb2RlbCwgeW91IGNhbiBwYXNzIGEgYGZpbGVzYCBvYmplY3Qgd2l0aCB0aGUgbmFtZXMgb2YgdGhlIGZpbGVzLCBmb3IgZXhhbXBsZTogYFwiZmlsZXNcIjoge1wiZGF0YVwiOiBcIm15RXh0cmFEYXRhLnhsc1wifWAuIChOb3RlIHRoYXQgeW91J2xsIGFsc28gbmVlZCB0byBhZGQgdGhpcyBzYW1lIGZpbGVzIG9iamVjdCB0byB5b3VyIFZlbnNpbSBbY29uZmlndXJhdGlvbiBmaWxlXSguLi8uLi8uLi9tb2RlbF9jb2RlL3ZlbnNpbS8pLikgU2VlIHRoZSBbdW5kZXJseWluZyBNb2RlbCBSdW4gQVBJXSguLi8uLi8uLi9yZXN0X2FwaXMvb3RoZXJfYXBpcy9tb2RlbF9hcGlzL3J1bi8jcG9zdC1jcmVhdGluZy1hLW5ldy1ydW4tZm9yLXRoaXMtcHJvamVjdCkgZm9yIGFkZGl0aW9uYWwgaW5mb3JtYXRpb24uXG4qXG4qICAgKiBgc3RyYXRlZ3lgOiAob3B0aW9uYWwpIFJ1biBjcmVhdGlvbiBzdHJhdGVneSBmb3Igd2hlbiB0byBjcmVhdGUgYSBuZXcgcnVuIGFuZCB3aGVuIHRvIHJldXNlIGFuIGVuZCB1c2VyJ3MgZXhpc3RpbmcgcnVuLiBTZWUgW1J1biBNYW5hZ2VyIFN0cmF0ZWdpZXNdKC4uLy4uL3N0cmF0ZWd5LykgZm9yIGRldGFpbHMuIERlZmF1bHRzIHRvIGBuZXctaWYtaW5pdGlhbGl6ZWRgLlxuKlxuKiAgICogYHNlc3Npb25LZXlgOiAob3B0aW9uYWwpIE5hbWUgb2YgYnJvd3NlciBjb29raWUgaW4gd2hpY2ggdG8gc3RvcmUgcnVuIGluZm9ybWF0aW9uLCBpbmNsdWRpbmcgcnVuIGlkLiBNYW55IGNvbmRpdGlvbmFsIHN0cmF0ZWdpZXMsIGluY2x1ZGluZyB0aGUgcHJvdmlkZWQgc3RyYXRlZ2llcywgcmVseSBvbiB0aGlzIGJyb3dzZXIgY29va2llIHRvIHN0b3JlIHRoZSBydW4gaWQgYW5kIGhlbHAgbWFrZSB0aGUgZGVjaXNpb24gb2Ygd2hldGhlciB0byBjcmVhdGUgYSBuZXcgcnVuIG9yIHVzZSBhbiBleGlzdGluZyBvbmUuIFRoZSBuYW1lIG9mIHRoaXMgY29va2llIGRlZmF1bHRzIHRvIGBlcGljZW50ZXItc2NlbmFyaW9gIGFuZCBjYW4gYmUgc2V0IHdpdGggdGhlIGBzZXNzaW9uS2V5YCBwYXJhbWV0ZXIuXG4qXG4qXG4qIEFmdGVyIGluc3RhbnRpYXRpbmcgYSBSdW4gTWFuYWdlciwgbWFrZSBhIGNhbGwgdG8gYGdldFJ1bigpYCB3aGVuZXZlciB5b3UgbmVlZCB0byBhY2Nlc3MgYSBydW4gZm9yIHRoaXMgZW5kIHVzZXIuIFRoZSBgUnVuTWFuYWdlci5ydW5gIGNvbnRhaW5zIHRoZSBpbnN0YW50aWF0ZWQgW1J1biBTZXJ2aWNlXSguLi9ydW4tYXBpLXNlcnZpY2UvKS5cbipcbiogKipFeGFtcGxlKipcbipcbiogICAgICAgdmFyIHJtID0gbmV3IEYubWFuYWdlci5SdW5NYW5hZ2VyKHtcbiogICAgICAgICAgIHJ1bjoge1xuKiAgICAgICAgICAgICAgIGFjY291bnQ6ICdhY21lLXNpbXVsYXRpb25zJyxcbiogICAgICAgICAgICAgICBwcm9qZWN0OiAnc3VwcGx5LWNoYWluLWdhbWUnLFxuKiAgICAgICAgICAgICAgIG1vZGVsOiAnc3VwcGx5LWNoYWluLW1vZGVsLmpsJyxcbiogICAgICAgICAgICAgICBzZXJ2ZXI6IHsgaG9zdDogJ2FwaS5mb3Jpby5jb20nIH1cbiogICAgICAgICAgIH0sXG4qICAgICAgICAgICBzdHJhdGVneTogJ2Fsd2F5cy1uZXcnLFxuKiAgICAgICAgICAgc2Vzc2lvbktleTogJ2VwaWNlbnRlci1zZXNzaW9uJ1xuKiAgICAgICB9KTtcbiogICAgICAgcm0uZ2V0UnVuKClcbiogICAgICAgICAgIC50aGVuKGZ1bmN0aW9uKHJ1bikge1xuKiAgICAgICAgICAgICAgIC8vIHRoZSByZXR1cm4gdmFsdWUgb2YgZ2V0UnVuKCkgaXMgYW4gaW5zdGFuY2Ugb2YgUnVuIFNlcnZpY2VcbiogICAgICAgICAgICAgICB2YXIgdGhpc1J1bklkID0gcnVuLmlkO1xuKiAgICAgICAgICAgICAgIC8vIHRoZSBSdW5NYW5hZ2VyLnJ1biBhbHNvIGNvbnRhaW5zIHRoZSBpbnN0YW50aWF0ZWQgUnVuIFNlcnZpY2UsXG4qICAgICAgICAgICAgICAgLy8gc28gYW55IFJ1biBTZXJ2aWNlIG1ldGhvZCBpcyB2YWxpZCBoZXJlXG4qICAgICAgICAgICAgICAgcm0ucnVuLmRvKCdydW5Nb2RlbCcpO1xuKiAgICAgICB9KVxuKlxuKi9cblxuJ3VzZSBzdHJpY3QnO1xudmFyIHN0cmF0ZWdpZXNNYXAgPSByZXF1aXJlKCcuL3J1bi1zdHJhdGVnaWVzL3N0cmF0ZWdpZXMtbWFwJyk7XG52YXIgc3BlY2lhbE9wZXJhdGlvbnMgPSByZXF1aXJlKCcuL3NwZWNpYWwtb3BlcmF0aW9ucycpO1xudmFyIFJ1blNlcnZpY2UgPSByZXF1aXJlKCcuLi9zZXJ2aWNlL3J1bi1hcGktc2VydmljZScpO1xuXG5cbmZ1bmN0aW9uIHBhdGNoUnVuU2VydmljZShzZXJ2aWNlLCBtYW5hZ2VyKSB7XG4gICAgaWYgKHNlcnZpY2UucGF0Y2hlZCkge1xuICAgICAgICByZXR1cm4gc2VydmljZTtcbiAgICB9XG5cbiAgICB2YXIgb3JpZyA9IHNlcnZpY2UuZG87XG4gICAgc2VydmljZS5kbyA9IGZ1bmN0aW9uIChvcGVyYXRpb24sIHBhcmFtcywgb3B0aW9ucykge1xuICAgICAgICB2YXIgcmVzZXJ2ZWRPcHMgPSBPYmplY3Qua2V5cyhzcGVjaWFsT3BlcmF0aW9ucyk7XG4gICAgICAgIGlmIChyZXNlcnZlZE9wcy5pbmRleE9mKG9wZXJhdGlvbikgPT09IC0xKSB7XG4gICAgICAgICAgICByZXR1cm4gb3JpZy5hcHBseShzZXJ2aWNlLCBhcmd1bWVudHMpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgcmV0dXJuIHNwZWNpYWxPcGVyYXRpb25zW29wZXJhdGlvbl0uY2FsbChzZXJ2aWNlLCBwYXJhbXMsIG9wdGlvbnMsIG1hbmFnZXIpO1xuICAgICAgICB9XG4gICAgfTtcblxuICAgIHNlcnZpY2UucGF0Y2hlZCA9IHRydWU7XG5cbiAgICByZXR1cm4gc2VydmljZTtcbn1cblxuXG5cbnZhciBkZWZhdWx0cyA9IHtcbiAgICAvKipcbiAgICAgKiBSdW4gY3JlYXRpb24gc3RyYXRlZ3kgZm9yIHdoZW4gdG8gY3JlYXRlIGEgbmV3IHJ1biBhbmQgd2hlbiB0byByZXVzZSBhbiBlbmQgdXNlcidzIGV4aXN0aW5nIHJ1bi4gU2VlIFtSdW4gTWFuYWdlciBTdHJhdGVnaWVzXSguLi8uLi9zdHJhdGVneS8pIGZvciBkZXRhaWxzLiBEZWZhdWx0cyB0byBgbmV3LWlmLWluaXRpYWxpemVkYC5cbiAgICAgKiBAdHlwZSB7U3RyaW5nfVxuICAgICAqL1xuXG4gICAgc3RyYXRlZ3k6ICduZXctaWYtaW5pdGlhbGl6ZWQnXG59O1xuXG5mdW5jdGlvbiBSdW5NYW5hZ2VyKG9wdGlvbnMpIHtcbiAgICB0aGlzLm9wdGlvbnMgPSAkLmV4dGVuZCh0cnVlLCB7fSwgZGVmYXVsdHMsIG9wdGlvbnMpO1xuXG4gICAgaWYgKHRoaXMub3B0aW9ucy5ydW4gaW5zdGFuY2VvZiBSdW5TZXJ2aWNlKSB7XG4gICAgICAgIHRoaXMucnVuID0gdGhpcy5vcHRpb25zLnJ1bjtcbiAgICB9IGVsc2Uge1xuICAgICAgICB0aGlzLnJ1biA9IG5ldyBSdW5TZXJ2aWNlKHRoaXMub3B0aW9ucy5ydW4pO1xuICAgIH1cblxuICAgIHBhdGNoUnVuU2VydmljZSh0aGlzLnJ1biwgdGhpcyk7XG5cbiAgICB2YXIgU3RyYXRlZ3lDdG9yID0gdHlwZW9mIHRoaXMub3B0aW9ucy5zdHJhdGVneSA9PT0gJ2Z1bmN0aW9uJyA/IHRoaXMub3B0aW9ucy5zdHJhdGVneSA6IHN0cmF0ZWdpZXNNYXBbdGhpcy5vcHRpb25zLnN0cmF0ZWd5XTtcblxuICAgIGlmICghU3RyYXRlZ3lDdG9yKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcignU3BlY2lmaWVkIHJ1biBjcmVhdGlvbiBzdHJhdGVneSB3YXMgaW52YWxpZDonLCB0aGlzLm9wdGlvbnMuc3RyYXRlZ3kpO1xuICAgIH1cblxuICAgIHRoaXMuc3RyYXRlZ3kgPSBuZXcgU3RyYXRlZ3lDdG9yKHRoaXMucnVuLCB0aGlzLm9wdGlvbnMpO1xufVxuXG5SdW5NYW5hZ2VyLnByb3RvdHlwZSA9IHtcbiAgICAvKipcbiAgICAgKiBSZXR1cm5zIHRoZSBydW4gb2JqZWN0IGZvciBhICdnb29kJyBydW4uXG4gICAgICpcbiAgICAgKiBBIGdvb2QgcnVuIGlzIGRlZmluZWQgYnkgdGhlIHN0cmF0ZWd5LiBGb3IgZXhhbXBsZSwgaWYgdGhlIHN0cmF0ZWd5IGlzIGBhbHdheXMtbmV3YCwgdGhlIGNhbGxcbiAgICAgKiB0byBgZ2V0UnVuKClgIGFsd2F5cyByZXR1cm5zIGEgbmV3bHkgY3JlYXRlZCBydW47IGlmIHRoZSBzdHJhdGVneSBpcyBgbmV3LWlmLXBlcnNpc3RlZGAsXG4gICAgICogYGdldFJ1bigpYCBjcmVhdGVzIGEgbmV3IHJ1biBpZiB0aGUgcHJldmlvdXMgcnVuIGlzIGluIGEgcGVyc2lzdGVkIHN0YXRlLCBvdGhlcndpc2VcbiAgICAgKiBpdCByZXR1cm5zIHRoZSBwcmV2aW91cyBydW4uIFNlZSBbUnVuIE1hbmFnZXIgU3RyYXRlZ2llc10oLi4vLi4vc3RyYXRlZ3kvKSBmb3IgbW9yZSBvbiBzdHJhdGVnaWVzLlxuICAgICAqXG4gICAgICogICoqRXhhbXBsZSoqXG4gICAgICpcbiAgICAgKiAgICAgIHJtLmdldFJ1bigpLnRoZW4oZnVuY3Rpb24gKHJ1bikge1xuICAgICAqICAgICAgICAgIC8vIHVzZSB0aGUgcnVuIG9iamVjdFxuICAgICAqICAgICAgICAgIHZhciB0aGlzUnVuSWQgPSBydW4uaWQ7XG4gICAgICpcbiAgICAgKiAgICAgICAgICAvLyB1c2UgdGhlIFJ1biBTZXJ2aWNlIG9iamVjdFxuICAgICAqICAgICAgICAgIHJ1bi5kbygncnVuTW9kZWwnKTtcbiAgICAgKiAgICAgIH0pO1xuICAgICAqXG4gICAgICogKipQYXJhbWV0ZXJzKipcbiAgICAgKiBAcGFyYW0ge05vbmV9IE5vbmVcbiAgICAgKi9cbiAgICBnZXRSdW46IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuc3RyYXRlZ3lcbiAgICAgICAgICAgICAgICAuZ2V0UnVuKCk7XG4gICAgfSxcblxuICAgIC8qKlxuICAgICAqIFJldHVybnMgdGhlIHJ1biBvYmplY3QgZm9yIGEgbmV3IHJ1biwgcmVnYXJkbGVzcyBvZiBzdHJhdGVneTogZm9yY2UgY3JlYXRpb24gb2YgYSBuZXcgcnVuLlxuICAgICAqXG4gICAgICogICoqRXhhbXBsZSoqXG4gICAgICpcbiAgICAgKiAgICAgIHJtLnJlc2V0KCkudGhlbihmdW5jdGlvbiAocnVuKSB7XG4gICAgICogICAgICAgICAgLy8gdXNlIHRoZSAobmV3KSBydW4gb2JqZWN0XG4gICAgICogICAgICAgICAgdmFyIHRoaXNSdW5JZCA9IHJ1bi5pZDtcbiAgICAgKiAgICAgICAgICAvLyB1c2UgdGhlIFJ1biBTZXJ2aWNlIG9iamVjdFxuICAgICAqICAgICAgICAgIHJ1bi5kbygncnVuTW9kZWwnKTtcbiAgICAgKiAgICAgIH0pO1xuICAgICAqXG4gICAgICogKipQYXJhbWV0ZXJzKipcbiAgICAgKiBAcGFyYW0ge09iamVjdH0gYHJ1blNlcnZpY2VPcHRpb25zYCBUaGUgb3B0aW9ucyBvYmplY3QgdG8gY29uZmlndXJlIHRoZSBSdW4gU2VydmljZS4gU2VlIFtSdW4gQVBJIFNlcnZpY2VdKC4uL3J1bi1hcGktc2VydmljZS8pIGZvciBtb3JlLlxuICAgICAqL1xuICAgIHJlc2V0OiBmdW5jdGlvbiAocnVuU2VydmljZU9wdGlvbnMpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuc3RyYXRlZ3kucmVzZXQocnVuU2VydmljZU9wdGlvbnMpO1xuICAgIH1cbn07XG5cbm1vZHVsZS5leHBvcnRzID0gUnVuTWFuYWdlcjtcbiIsIid1c2Ugc3RyaWN0JztcblxudmFyIGNsYXNzRnJvbSA9IHJlcXVpcmUoJy4uLy4uL3V0aWwvaW5oZXJpdCcpO1xudmFyIENvbmRpdGlvbmFsU3RyYXRlZ3kgPSByZXF1aXJlKCcuL2NvbmRpdGlvbmFsLWNyZWF0aW9uLXN0cmF0ZWd5Jyk7XG5cbnZhciBfX3N1cGVyID0gQ29uZGl0aW9uYWxTdHJhdGVneS5wcm90b3R5cGU7XG5cbnZhciBTdHJhdGVneSA9IGNsYXNzRnJvbShDb25kaXRpb25hbFN0cmF0ZWd5LCB7XG4gICAgY29uc3RydWN0b3I6IGZ1bmN0aW9uIChydW5TZXJ2aWNlLCBvcHRpb25zKSB7XG4gICAgICAgIF9fc3VwZXIuY29uc3RydWN0b3IuY2FsbCh0aGlzLCBydW5TZXJ2aWNlLCB0aGlzLmNyZWF0ZUlmLCBvcHRpb25zKTtcbiAgICB9LFxuXG4gICAgY3JlYXRlSWY6IGZ1bmN0aW9uIChydW4sIGhlYWRlcnMpIHtcbiAgICAgICAgLy8gYWx3YXlzIGNyZWF0ZSBhIG5ldyBydW4hXG4gICAgICAgIHJldHVybiB0cnVlO1xuICAgIH1cbn0pO1xuXG5tb2R1bGUuZXhwb3J0cyA9IFN0cmF0ZWd5O1xuIiwiJ3VzZSBzdHJpY3QnO1xuXG52YXIgY2xhc3NGcm9tID0gcmVxdWlyZSgnLi4vLi4vdXRpbC9pbmhlcml0Jyk7XG52YXIgSWRlbnRpdHlTdHJhdGVneSA9IHJlcXVpcmUoJy4vaWRlbnRpdHktc3RyYXRlZ3knKTtcbnZhciBTdG9yYWdlRmFjdG9yeSA9IHJlcXVpcmUoJy4uLy4uL3N0b3JlL3N0b3JlLWZhY3RvcnknKTtcbnZhciBTdGF0ZUFwaSA9IHJlcXVpcmUoJy4uLy4uL3NlcnZpY2Uvc3RhdGUtYXBpLWFkYXB0ZXInKTtcbnZhciBBdXRoTWFuYWdlciA9IHJlcXVpcmUoJy4uL2F1dGgtbWFuYWdlcicpO1xudmFyIGtleU5hbWVzID0gcmVxdWlyZSgnLi4va2V5LW5hbWVzJyk7XG5cbnZhciBkZWZhdWx0cyA9IHtcbiAgICBzdG9yZToge1xuICAgICAgICBzeW5jaHJvbm91czogdHJ1ZVxuICAgIH1cbn07XG5cbnZhciBTdHJhdGVneSA9IGNsYXNzRnJvbShJZGVudGl0eVN0cmF0ZWd5LCB7XG4gICAgY29uc3RydWN0b3I6IGZ1bmN0aW9uIFN0cmF0ZWd5KHJ1blNlcnZpY2UsIG9wdGlvbnMpIHtcbiAgICAgICAgdGhpcy5ydW4gPSBydW5TZXJ2aWNlO1xuICAgICAgICB0aGlzLm9wdGlvbnMgPSAkLmV4dGVuZCh0cnVlLCB7fSwgZGVmYXVsdHMsIG9wdGlvbnMpO1xuICAgICAgICB0aGlzLnJ1bk9wdGlvbnMgPSB0aGlzLm9wdGlvbnMucnVuO1xuICAgICAgICB0aGlzLl9zdG9yZSA9IG5ldyBTdG9yYWdlRmFjdG9yeSh0aGlzLm9wdGlvbnMuc3RvcmUpO1xuICAgICAgICB0aGlzLnN0YXRlQXBpID0gbmV3IFN0YXRlQXBpKCk7XG4gICAgICAgIHRoaXMuX2F1dGggPSBuZXcgQXV0aE1hbmFnZXIoKTtcblxuICAgICAgICB0aGlzLl9sb2FkQW5kQ2hlY2sgPSB0aGlzLl9sb2FkQW5kQ2hlY2suYmluZCh0aGlzKTtcbiAgICAgICAgdGhpcy5fcmVzdG9yZVJ1biA9IHRoaXMuX3Jlc3RvcmVSdW4uYmluZCh0aGlzKTtcbiAgICAgICAgdGhpcy5fZ2V0QWxsUnVucyA9IHRoaXMuX2dldEFsbFJ1bnMuYmluZCh0aGlzKTtcbiAgICAgICAgdGhpcy5fbG9hZFJ1biA9IHRoaXMuX2xvYWRSdW4uYmluZCh0aGlzKTtcbiAgICB9LFxuXG4gICAgcmVzZXQ6IGZ1bmN0aW9uIChydW5TZXJ2aWNlT3B0aW9ucykge1xuICAgICAgICAvLyBjcmVhdGVzIGEgZ3JhbmQgbmV3IHJ1biB3aXRoIGdyb3VwIGlkIChhY2NvdW50IHRvbz8pIGFuZCBzZXQgZnJlc2hseSBjcmVhdGVkIHRvIHRydWVcbiAgICAgICAgdmFyIHNlc3Npb24gPSB0aGlzLl9hdXRoLmdldEN1cnJlbnRVc2VyU2Vzc2lvbkluZm8oKTtcbiAgICAgICAgdmFyIG9wdCA9ICQuZXh0ZW5kKHtcbiAgICAgICAgICAgIHNjb3BlOiB7IGdyb3VwOiBzZXNzaW9uLmdyb3VwSWQgfVxuICAgICAgICB9LCB0aGlzLnJ1bk9wdGlvbnMpO1xuXG4gICAgICAgIHJldHVybiB0aGlzLnJ1blxuICAgICAgICAgICAgLmNyZWF0ZShvcHQsIHJ1blNlcnZpY2VPcHRpb25zKVxuICAgICAgICAgICAgLnRoZW4oZnVuY3Rpb24gKHJ1bikge1xuICAgICAgICAgICAgICAgIHJ1bi5mcmVzaGx5Q3JlYXRlZCA9IHRydWU7XG4gICAgICAgICAgICAgICAgcmV0dXJuIHJ1bjtcbiAgICAgICAgICAgIH0pO1xuICAgIH0sXG5cbiAgICBnZXRSdW46IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuX2dldEFsbFJ1bnMoKVxuICAgICAgICAgICAgLnRoZW4odGhpcy5fbG9hZEFuZENoZWNrKTtcbiAgICB9LFxuXG4gICAgX2dldEFsbFJ1bnM6IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgLy8gZ2V0IGFsbCBydW5zIHdpdGggdGhlIGN1cnJlbnQgdXNlciBhbmQgZ3JvdXAsIHRvIGJlIGZpbHRlcmVkIGxhdGVyXG4gICAgICAgIHZhciBzZXNzaW9uID0gSlNPTi5wYXJzZSh0aGlzLl9zdG9yZS5nZXQoa2V5TmFtZXMuRVBJX1NFU1NJT05fS0VZKSB8fCAne30nKTtcbiAgICAgICAgcmV0dXJuIHRoaXMucnVuLnF1ZXJ5KHtcbiAgICAgICAgICAgICd1c2VyLmlkJzogc2Vzc2lvbi51c2VySWQgfHwgJzAwMDAnLFxuICAgICAgICAgICAgJ3Njb3BlLmdyb3VwJzogc2Vzc2lvbi5ncm91cElkXG4gICAgICAgIH0pO1xuICAgIH0sXG5cbiAgICBfbG9hZEFuZENoZWNrOiBmdW5jdGlvbiAocnVucykge1xuICAgICAgICAvLyBDaGVjayBpZiBsYXRlc3QgcnVuIGlzIG5vdCB5ZXQgaW5pdGlhbGl6ZWQsIGlmIG5vdCB3ZSBsb2FkIGl0LCBlbHNlIHdlIGxvYWQgdGhlIGJhc2VydW4sIGVsc2UgY3JlYXRlIG5ldyBydW5cbiAgICAgICAgaWYgKCFydW5zIHx8ICFydW5zLmxlbmd0aCkge1xuICAgICAgICAgICAgcmV0dXJuIHRoaXMucmVzZXQoKTtcbiAgICAgICAgfVxuICAgICAgICB2YXIgbGF0ZXN0UnVuID0gdGhpcy5fc29ydFJ1bnMocnVucylbMF07XG4gICAgICAgIHZhciBfdGhpcyA9IHRoaXM7XG4gICAgICAgIHZhciBzaG91bGRSZXBsYXkgPSBmYWxzZTtcbiAgICAgICAgdmFyIGJhc2VSdW5zID0gdGhpcy5fc29ydFJ1bnModGhpcy5fYmFzZVJ1bnMocnVucykpO1xuXG5cbiAgICAgICAgaWYgKCFsYXRlc3RSdW4uaW5pdGlhbGl6ZWQpIHtcbiAgICAgICAgICAgIC8vIHVuaW5pdGlhbGl6ZWQgcnVuIHdpbGwgaGF2ZSBmaW5pc2ggaW5pdGlhbGl6aW5nIGZpcnN0XG4gICAgICAgICAgICByZXR1cm4gdGhpcy5ydW4ubG9hZChsYXRlc3RSdW4uaWQsIG51bGwsIHtcbiAgICAgICAgICAgICAgICBzdWNjZXNzOiBmdW5jdGlvbiAocnVuLCBtc2csIGhlYWRlcnMpIHtcbiAgICAgICAgICAgICAgICAgICAgc2hvdWxkUmVwbGF5ID0gaGVhZGVycy5nZXRSZXNwb25zZUhlYWRlcigncHJhZ21hJykgPT09ICdwZXJzaXN0ZW50JztcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9KS50aGVuKGZ1bmN0aW9uIChydW4pIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gc2hvdWxkUmVwbGF5ID8gX3RoaXMuX3Jlc3RvcmVSdW4ocnVuLmlkKSA6IHJ1bjtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9IGVsc2UgaWYgKGJhc2VSdW5zICYmIGJhc2VSdW5zLmxlbmd0aCkge1xuICAgICAgICAgICAgdmFyIGJhc2VSdW4gPSBiYXNlUnVuc1swXTtcbiAgICAgICAgICAgIHJldHVybiB0aGlzLnJ1bi5sb2FkKGJhc2VSdW4uaWQsIG51bGwsIHtcbiAgICAgICAgICAgICAgICBzdWNjZXNzOiBmdW5jdGlvbiAocnVuLCBtc2csIGhlYWRlcnMpIHtcbiAgICAgICAgICAgICAgICAgICAgc2hvdWxkUmVwbGF5ID0gaGVhZGVycy5nZXRSZXNwb25zZUhlYWRlcigncHJhZ21hJykgPT09ICdwZXJzaXN0ZW50JztcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9KS50aGVuKGZ1bmN0aW9uIChydW4pIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gc2hvdWxkUmVwbGF5ID8gX3RoaXMuX3Jlc3RvcmVSdW4ocnVuLmlkKSA6IHJ1bjtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgcmV0dXJuIHRoaXMucmVzZXQoKTtcbiAgICAgICAgfVxuICAgIH0sXG5cbiAgICBfc29ydFJ1bnM6IGZ1bmN0aW9uIChydW5zKSB7XG4gICAgICAgIHZhciBkYXRlQ29tcCA9IGZ1bmN0aW9uIChhLCBiKSB7IHJldHVybiBuZXcgRGF0ZShiLmRhdGUpIC0gbmV3IERhdGUoYS5kYXRlKTsgfTtcbiAgICAgICAgcmV0dXJuIHJ1bnMuc29ydChkYXRlQ29tcCk7XG4gICAgfSxcblxuICAgIF9iYXNlUnVuczogZnVuY3Rpb24gKHJ1bnMpIHtcbiAgICAgICAgcmV0dXJuIF8uZmlsdGVyKHJ1bnMsIGZ1bmN0aW9uIChydW4pIHtcbiAgICAgICAgICAgIHJldHVybiBydW4uYmFzZVJ1bjtcbiAgICAgICAgfSk7XG4gICAgfSxcblxuICAgIF9yZXN0b3JlUnVuOiBmdW5jdGlvbiAocnVuSWQpIHtcbiAgICAgICAgdmFyIF90aGlzID0gdGhpcztcbiAgICAgICAgcmV0dXJuIHRoaXMuc3RhdGVBcGkucmVwbGF5KHsgcnVuSWQ6IHJ1bklkIH0pXG4gICAgICAgICAgICAudGhlbihmdW5jdGlvbiAocmVzcCkge1xuICAgICAgICAgICAgICAgIHJldHVybiBfdGhpcy5fbG9hZFJ1bihyZXNwLnJ1bik7XG4gICAgICAgICAgICB9KTtcbiAgICB9LFxuXG4gICAgX2xvYWRSdW46IGZ1bmN0aW9uIChpZCwgb3B0aW9ucykge1xuICAgICAgICByZXR1cm4gdGhpcy5ydW4ubG9hZChpZCwgbnVsbCwgb3B0aW9ucyk7XG4gICAgfVxuXG59KTtcblxubW9kdWxlLmV4cG9ydHMgPSBTdHJhdGVneTtcbiIsIid1c2Ugc3RyaWN0JztcblxudmFyIG1ha2VTZXEgPSByZXF1aXJlKCcuLi8uLi91dGlsL21ha2Utc2VxdWVuY2UnKTtcbnZhciBCYXNlID0gcmVxdWlyZSgnLi9pZGVudGl0eS1zdHJhdGVneScpO1xudmFyIFNlc3Npb25TdG9yZSA9IHJlcXVpcmUoJy4uLy4uL3N0b3JlL3N0b3JlLWZhY3RvcnknKTtcbnZhciBjbGFzc0Zyb20gPSByZXF1aXJlKCcuLi8uLi91dGlsL2luaGVyaXQnKTtcbnZhciBVcmxTZXJ2aWNlID0gcmVxdWlyZSgnLi4vLi4vc2VydmljZS91cmwtY29uZmlnLXNlcnZpY2UnKTtcbnZhciBBdXRoTWFuYWdlciA9IHJlcXVpcmUoJy4uL2F1dGgtbWFuYWdlcicpO1xuXG52YXIgc2Vzc2lvblN0b3JlID0gbmV3IFNlc3Npb25TdG9yZSh7fSk7XG52YXIgdXJsU2VydmljZSA9IG5ldyBVcmxTZXJ2aWNlKCk7XG52YXIga2V5TmFtZXMgPSByZXF1aXJlKCcuLi9rZXktbmFtZXMnKTtcblxudmFyIGRlZmF1bHRzID0ge1xuICAgIHNlc3Npb25LZXk6IGtleU5hbWVzLlNUUkFURUdZX1NFU1NJT05fS0VZXG59O1xuXG5mdW5jdGlvbiBzZXRSdW5JblNlc3Npb24oc2Vzc2lvbktleSwgcnVuKSB7XG4gICAgdmFyIHBhdGggPSAnLycgKyBbdXJsU2VydmljZS5hcHBQYXRoLCB1cmxTZXJ2aWNlLmFjY291bnRQYXRoLCB1cmxTZXJ2aWNlLnByb2plY3RQYXRoXS5qb2luKCcvJyk7XG5cbiAgICAvLyBtYWtlIHN1cmUgd2UgZG9uJ3QgZ2V0IGNvbnNlY3V0ZWl2ZSAnLycgc28gd2UgaGF2ZSBhIHZhbGlkIHBhdGggZm9yIHRoZSBzZXNzaW9uXG4gICAgcGF0aCA9IHBhdGgucmVwbGFjZSgvXFwvezIsfS9nLCcvJyk7XG5cbiAgICAvLyBzZXQgdGhlIHNlZXNpb25LZXkgZm9yIHRoZSBydW5cbiAgICBzZXNzaW9uU3RvcmUuc2V0KHNlc3Npb25LZXksIEpTT04uc3RyaW5naWZ5KHsgcnVuSWQ6IHJ1bi5pZCB9KSwgeyByb290OiBwYXRoIH0pO1xufVxuXG4vKipcbiogQ29uZGl0aW9uYWwgQ3JlYXRpb24gU3RyYXRlZ3lcbiogVGhpcyBzdHJhdGVneSB3aWxsIHRyeSB0byBnZXQgdGhlIHJ1biBzdG9yZWQgaW4gdGhlIGNvb2tpZSBhbmRcbiogZXZhbHVhdGUgaWYgbmVlZHMgdG8gY3JlYXRlIGEgbmV3IHJ1biBieSBjYWxsaW5nIHRoZSAnY29uZGl0aW9uJyBmdW5jdGlvblxuKi9cblxuLyoganNoaW50IGVxbnVsbDogdHJ1ZSAqL1xudmFyIFN0cmF0ZWd5ID0gY2xhc3NGcm9tKEJhc2UsIHtcbiAgICBjb25zdHJ1Y3RvcjogZnVuY3Rpb24gU3RyYXRlZ3kocnVuU2VydmljZSwgY29uZGl0aW9uLCBvcHRpb25zKSB7XG5cbiAgICAgICAgaWYgKGNvbmRpdGlvbiA9PSBudWxsKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ0NvbmRpdGlvbmFsIHN0cmF0ZWd5IG5lZWRzIGEgY29uZGl0aW9uIHRvIGNyZWF0ZXRlIGEgcnVuJyk7XG4gICAgICAgIH1cblxuICAgICAgICB0aGlzLl9hdXRoID0gbmV3IEF1dGhNYW5hZ2VyKCk7XG4gICAgICAgIHRoaXMucnVuID0gbWFrZVNlcShydW5TZXJ2aWNlKTtcbiAgICAgICAgdGhpcy5jb25kaXRpb24gPSB0eXBlb2YgY29uZGl0aW9uICE9PSAnZnVuY3Rpb24nID8gZnVuY3Rpb24gKCkgeyByZXR1cm4gY29uZGl0aW9uOyB9IDogY29uZGl0aW9uO1xuICAgICAgICB0aGlzLm9wdGlvbnMgPSAkLmV4dGVuZCh0cnVlLCB7fSwgZGVmYXVsdHMsIG9wdGlvbnMpO1xuICAgICAgICB0aGlzLnJ1bk9wdGlvbnMgPSB0aGlzLm9wdGlvbnMucnVuO1xuICAgIH0sXG5cbiAgICByZXNldDogZnVuY3Rpb24gKHJ1blNlcnZpY2VPcHRpb25zKSB7XG4gICAgICAgIHZhciBfdGhpcyA9IHRoaXM7XG4gICAgICAgIHZhciBzZXNzaW9uID0gdGhpcy5fYXV0aC5nZXRDdXJyZW50VXNlclNlc3Npb25JbmZvKCk7XG4gICAgICAgIHZhciBvcHQgPSAkLmV4dGVuZCh7XG4gICAgICAgICAgICBzY29wZTogeyBncm91cDogc2Vzc2lvbi5ncm91cElkIH1cbiAgICAgICAgfSwgdGhpcy5ydW5PcHRpb25zKTtcblxuICAgICAgICByZXR1cm4gdGhpcy5ydW5cbiAgICAgICAgICAgICAgICAuY3JlYXRlKG9wdCwgcnVuU2VydmljZU9wdGlvbnMpXG4gICAgICAgICAgICAudGhlbihmdW5jdGlvbiAocnVuKSB7XG4gICAgICAgICAgICAgICAgc2V0UnVuSW5TZXNzaW9uKF90aGlzLm9wdGlvbnMuc2Vzc2lvbktleSwgcnVuKTtcbiAgICAgICAgICAgICAgICBydW4uZnJlc2hseUNyZWF0ZWQgPSB0cnVlO1xuICAgICAgICAgICAgICAgIHJldHVybiBydW47XG4gICAgICAgICAgICB9KVxuICAgICAgICAgICAgLnN0YXJ0KCk7XG4gICAgfSxcblxuICAgIGdldFJ1bjogZnVuY3Rpb24gKCkge1xuICAgICAgICB2YXIgc2Vzc2lvbiA9IHRoaXMuX2F1dGguZ2V0Q3VycmVudFVzZXJTZXNzaW9uSW5mbygpO1xuXG4gICAgICAgIGlmIChzZXNzaW9uICYmIHNlc3Npb24ucnVuSWQpIHtcbiAgICAgICAgICAgIHJldHVybiB0aGlzLl9sb2FkQW5kQ2hlY2soc2Vzc2lvbik7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICByZXR1cm4gdGhpcy5yZXNldCgpO1xuICAgICAgICB9XG4gICAgfSxcblxuICAgIF9sb2FkQW5kQ2hlY2s6IGZ1bmN0aW9uIChzZXNzaW9uKSB7XG4gICAgICAgIHZhciBzaG91bGRDcmVhdGUgPSBmYWxzZTtcbiAgICAgICAgdmFyIF90aGlzID0gdGhpcztcblxuICAgICAgICByZXR1cm4gdGhpcy5ydW5cbiAgICAgICAgICAgIC5sb2FkKHNlc3Npb24ucnVuSWQsIG51bGwsIHtcbiAgICAgICAgICAgICAgICBzdWNjZXNzOiBmdW5jdGlvbiAocnVuLCBtc2csIGhlYWRlcnMpIHtcbiAgICAgICAgICAgICAgICAgICAgc2hvdWxkQ3JlYXRlID0gX3RoaXMuY29uZGl0aW9uLmNhbGwoX3RoaXMsIHJ1biwgaGVhZGVycyk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSlcbiAgICAgICAgICAgIC50aGVuKGZ1bmN0aW9uIChydW4pIHtcbiAgICAgICAgICAgICAgICBpZiAoc2hvdWxkQ3JlYXRlKSB7XG4gICAgICAgICAgICAgICAgICAgIC8vIHdlIG5lZWQgdG8gZG8gdGhpcywgb24gdGhlIG9yaWdpbmFsIHJ1blNlcnZpY2UgKGllIG5vdCBzZXF1ZW5jaWFsaXplZClcbiAgICAgICAgICAgICAgICAgICAgLy8gc28gd2UgZG9uJ3QgZ2V0IGluIHRoZSBtaWRkbGUgb2YgdGhlIHF1ZXVlXG4gICAgICAgICAgICAgICAgICAgIHJldHVybiBfdGhpcy5ydW4ub3JpZ2luYWwuY3JlYXRlKF90aGlzLnJ1bk9wdGlvbnMpXG4gICAgICAgICAgICAgICAgICAgIC50aGVuKGZ1bmN0aW9uIChydW4pIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHNldFJ1bkluU2Vzc2lvbihfdGhpcy5vcHRpb25zLnNlc3Npb25LZXksIHJ1bik7XG4gICAgICAgICAgICAgICAgICAgICAgICBydW4uZnJlc2hseUNyZWF0ZWQgPSB0cnVlO1xuICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuIHJ1bjtcbiAgICAgICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgcmV0dXJuIHJ1bjtcbiAgICAgICAgICAgIH0pXG4gICAgICAgICAgICAuc3RhcnQoKTtcbiAgICB9XG59KTtcblxubW9kdWxlLmV4cG9ydHMgPSBTdHJhdGVneTtcbiIsIid1c2Ugc3RyaWN0JztcblxudmFyIGNsYXNzRnJvbSA9IHJlcXVpcmUoJy4uLy4uL3V0aWwvaW5oZXJpdCcpO1xudmFyIEJhc2UgPSB7fTtcblxuLy8gSW50ZXJmYWNlIHRoYXQgYWxsIHN0cmF0ZWdpZXMgbmVlZCB0byBpbXBsZW1lbnRcbm1vZHVsZS5leHBvcnRzID0gY2xhc3NGcm9tKEJhc2UsIHtcbiAgICBjb25zdHJ1Y3RvcjogZnVuY3Rpb24gKHJ1blNlcnZpY2UsIG9wdGlvbnMpIHtcbiAgICAgICAgdGhpcy5ydW5TZXJ2aWNlICA9IHJ1blNlcnZpY2U7XG4gICAgfSxcblxuICAgIHJlc2V0OiBmdW5jdGlvbiAoKSB7XG4gICAgICAgIC8vIHJldHVybiBhIG5ld2x5IGNyZWF0ZWQgcnVuXG4gICAgICAgIHJldHVybiAkLkRlZmVycmVkKCkucmVzb2x2ZSgpLnByb21pc2UoKTtcbiAgICB9LFxuXG4gICAgZ2V0UnVuOiBmdW5jdGlvbiAoKSB7XG4gICAgICAgIC8vIHJldHVybiBhIHVzYWJsZSBydW5cbiAgICAgICAgcmV0dXJuICQuRGVmZXJyZWQoKS5yZXNvbHZlKHRoaXMucnVuU2VydmljZSkucHJvbWlzZSgpO1xuICAgIH1cbn0pO1xuIiwiJ3VzZSBzdHJpY3QnO1xuXG52YXIgY2xhc3NGcm9tID0gcmVxdWlyZSgnLi4vLi4vdXRpbC9pbmhlcml0Jyk7XG5cbnZhciBJZGVudGl0eVN0cmF0ZWd5ID0gcmVxdWlyZSgnLi9pZGVudGl0eS1zdHJhdGVneScpO1xudmFyIFdvcmxkQXBpQWRhcHRlciA9IHJlcXVpcmUoJy4uLy4uL3NlcnZpY2Uvd29ybGQtYXBpLWFkYXB0ZXInKTtcbnZhciBBdXRoTWFuYWdlciA9IHJlcXVpcmUoJy4uL2F1dGgtbWFuYWdlcicpO1xuXG52YXIgZGVmYXVsdHMgPSB7XG4gICAgc3RvcmU6IHtcbiAgICAgICAgc3luY2hyb25vdXM6IHRydWVcbiAgICB9XG59O1xuXG52YXIgU3RyYXRlZ3kgPSBjbGFzc0Zyb20oSWRlbnRpdHlTdHJhdGVneSwge1xuXG4gICAgY29uc3RydWN0b3I6IGZ1bmN0aW9uIChydW5TZXJ2aWNlLCBvcHRpb25zKSB7XG4gICAgICAgIHRoaXMucnVuU2VydmljZSA9IHJ1blNlcnZpY2U7XG4gICAgICAgIHRoaXMub3B0aW9ucyA9ICQuZXh0ZW5kKHRydWUsIHt9LCBkZWZhdWx0cywgb3B0aW9ucyk7XG4gICAgICAgIHRoaXMuX2F1dGggPSBuZXcgQXV0aE1hbmFnZXIoKTtcbiAgICAgICAgdGhpcy5fbG9hZFJ1biA9IHRoaXMuX2xvYWRSdW4uYmluZCh0aGlzKTtcbiAgICAgICAgdGhpcy53b3JsZEFwaSA9IG5ldyBXb3JsZEFwaUFkYXB0ZXIodGhpcy5vcHRpb25zLnJ1bik7XG4gICAgfSxcblxuICAgIHJlc2V0OiBmdW5jdGlvbiAoKSB7XG4gICAgICAgIHZhciBzZXNzaW9uID0gdGhpcy5fYXV0aC5nZXRDdXJyZW50VXNlclNlc3Npb25JbmZvKCk7XG4gICAgICAgIHZhciBjdXJVc2VySWQgPSBzZXNzaW9uLnVzZXJJZDtcbiAgICAgICAgdmFyIGN1ckdyb3VwTmFtZSA9IHNlc3Npb24uZ3JvdXBOYW1lO1xuXG4gICAgICAgIHJldHVybiB0aGlzLndvcmxkQXBpXG4gICAgICAgICAgICAuZ2V0Q3VycmVudFdvcmxkRm9yVXNlcihjdXJVc2VySWQsIGN1ckdyb3VwTmFtZSlcbiAgICAgICAgICAgIC50aGVuKGZ1bmN0aW9uICh3b3JsZCkge1xuICAgICAgICAgICAgICAgIHJldHVybiB0aGlzLndvcmxkQXBpLm5ld1J1bkZvcldvcmxkKHdvcmxkLmlkKTtcbiAgICAgICAgICAgIH0uYmluZCh0aGlzKSk7XG4gICAgfSxcblxuICAgIGdldFJ1bjogZnVuY3Rpb24gKCkge1xuICAgICAgICB2YXIgc2Vzc2lvbiA9IHRoaXMuX2F1dGguZ2V0Q3VycmVudFVzZXJTZXNzaW9uSW5mbygpO1xuICAgICAgICB2YXIgY3VyVXNlcklkID0gc2Vzc2lvbi51c2VySWQ7XG4gICAgICAgIHZhciBjdXJHcm91cE5hbWUgPSBzZXNzaW9uLmdyb3VwTmFtZTtcbiAgICAgICAgdmFyIHdvcmxkQXBpID0gdGhpcy53b3JsZEFwaTtcbiAgICAgICAgdmFyIG1vZGVsID0gdGhpcy5vcHRpb25zLm1vZGVsO1xuICAgICAgICB2YXIgX3RoaXMgPSB0aGlzO1xuICAgICAgICB2YXIgZHRkID0gJC5EZWZlcnJlZCgpO1xuXG4gICAgICAgIGlmICghY3VyVXNlcklkKSB7XG4gICAgICAgICAgICByZXR1cm4gZHRkLnJlamVjdCh7IHN0YXR1c0NvZGU6IDQwMCwgZXJyb3I6ICdXZSBuZWVkIGFuIGF1dGhlbnRpY2F0ZWQgdXNlciB0byBqb2luIGEgbXVsdGlwbGF5ZXIgd29ybGQuIChFUlI6IG5vIHVzZXJJZCBpbiBzZXNzaW9uKScgfSwgc2Vzc2lvbikucHJvbWlzZSgpO1xuICAgICAgICB9XG5cbiAgICAgICAgdmFyIGxvYWRSdW5Gcm9tV29ybGQgPSBmdW5jdGlvbiAod29ybGQpIHtcbiAgICAgICAgICAgIGlmICghd29ybGQpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gZHRkLnJlamVjdCh7IHN0YXR1c0NvZGU6IDQwNCwgZXJyb3I6ICdUaGUgdXNlciBpcyBub3QgaW4gYW55IHdvcmxkLicgfSwgeyBvcHRpb25zOiB0aGlzLm9wdGlvbnMsIHNlc3Npb246IHNlc3Npb24gfSk7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIHJldHVybiB3b3JsZEFwaS5nZXRDdXJyZW50UnVuSWQoeyBtb2RlbDogbW9kZWwsIGZpbHRlcjogd29ybGQuaWQgfSlcbiAgICAgICAgICAgICAgICAudGhlbihfdGhpcy5fbG9hZFJ1bilcbiAgICAgICAgICAgICAgICAudGhlbihkdGQucmVzb2x2ZSlcbiAgICAgICAgICAgICAgICAuZmFpbChkdGQucmVqZWN0KTtcbiAgICAgICAgfTtcblxuICAgICAgICB2YXIgc2VydmVyRXJyb3IgPSBmdW5jdGlvbiAoZXJyb3IpIHtcbiAgICAgICAgICAgIC8vIGlzIHRoaXMgcG9zc2libGU/XG4gICAgICAgICAgICBkdGQucmVqZWN0KGVycm9yLCBzZXNzaW9uLCB0aGlzLm9wdGlvbnMpO1xuICAgICAgICB9O1xuXG4gICAgICAgIHRoaXMud29ybGRBcGlcbiAgICAgICAgICAgIC5nZXRDdXJyZW50V29ybGRGb3JVc2VyKGN1clVzZXJJZCwgY3VyR3JvdXBOYW1lKVxuICAgICAgICAgICAgLnRoZW4obG9hZFJ1bkZyb21Xb3JsZClcbiAgICAgICAgICAgIC5mYWlsKHNlcnZlckVycm9yKTtcblxuICAgICAgICByZXR1cm4gZHRkLnByb21pc2UoKTtcbiAgICB9LFxuXG4gICAgX2xvYWRSdW46IGZ1bmN0aW9uIChpZCwgb3B0aW9ucykge1xuICAgICAgICByZXR1cm4gdGhpcy5ydW5TZXJ2aWNlLmxvYWQoaWQsIG51bGwsIG9wdGlvbnMpO1xuICAgIH1cbn0pO1xuXG5tb2R1bGUuZXhwb3J0cyA9IFN0cmF0ZWd5O1xuIiwiJ3VzZSBzdHJpY3QnO1xudmFyIGNsYXNzRnJvbSA9IHJlcXVpcmUoJy4uLy4uL3V0aWwvaW5oZXJpdCcpO1xudmFyIENvbmRpdGlvbmFsU3RyYXRlZ3kgPSByZXF1aXJlKCcuL2NvbmRpdGlvbmFsLWNyZWF0aW9uLXN0cmF0ZWd5Jyk7XG5cbnZhciBfX3N1cGVyID0gQ29uZGl0aW9uYWxTdHJhdGVneS5wcm90b3R5cGU7XG5cbnZhciBTdHJhdGVneSA9IGNsYXNzRnJvbShDb25kaXRpb25hbFN0cmF0ZWd5LCB7XG4gICAgY29uc3RydWN0b3I6IGZ1bmN0aW9uIChydW5TZXJ2aWNlLCBvcHRpb25zKSB7XG4gICAgICAgIF9fc3VwZXIuY29uc3RydWN0b3IuY2FsbCh0aGlzLCBydW5TZXJ2aWNlLCB0aGlzLmNyZWF0ZUlmLCBvcHRpb25zKTtcbiAgICB9LFxuXG4gICAgY3JlYXRlSWY6IGZ1bmN0aW9uIChydW4sIGhlYWRlcnMpIHtcbiAgICAgICAgcmV0dXJuIGhlYWRlcnMuZ2V0UmVzcG9uc2VIZWFkZXIoJ3ByYWdtYScpID09PSAncGVyc2lzdGVudCcgfHwgcnVuLmluaXRpYWxpemVkO1xuICAgIH1cbn0pO1xuXG5tb2R1bGUuZXhwb3J0cyA9IFN0cmF0ZWd5O1xuIiwiJ3VzZSBzdHJpY3QnO1xuXG52YXIgY2xhc3NGcm9tID0gcmVxdWlyZSgnLi4vLi4vdXRpbC9pbmhlcml0Jyk7XG52YXIgQ29uZGl0aW9uYWxTdHJhdGVneSA9IHJlcXVpcmUoJy4vY29uZGl0aW9uYWwtY3JlYXRpb24tc3RyYXRlZ3knKTtcblxudmFyIF9fc3VwZXIgPSBDb25kaXRpb25hbFN0cmF0ZWd5LnByb3RvdHlwZTtcblxuLypcbiogIGNyZWF0ZSBhIG5ldyBydW4gb25seSBpZiBub3RoaW5nIGlzIHN0b3JlZCBpbiB0aGUgY29va2llXG4qICB0aGlzIGlzIHVzZWZ1bCBmb3IgYmFzZVJ1bnMuXG4qL1xudmFyIFN0cmF0ZWd5ID0gY2xhc3NGcm9tKENvbmRpdGlvbmFsU3RyYXRlZ3ksIHtcbiAgICBjb25zdHJ1Y3RvcjogZnVuY3Rpb24gKHJ1blNlcnZpY2UsIG9wdGlvbnMpIHtcbiAgICAgICAgX19zdXBlci5jb25zdHJ1Y3Rvci5jYWxsKHRoaXMsIHJ1blNlcnZpY2UsIHRoaXMuY3JlYXRlSWYsIG9wdGlvbnMpO1xuICAgIH0sXG5cbiAgICBjcmVhdGVJZjogZnVuY3Rpb24gKHJ1biwgaGVhZGVycykge1xuICAgICAgICAvLyBpZiB3ZSBhcmUgaGVyZSwgaXQgbWVhbnMgdGhhdCB0aGUgcnVuIGV4aXN0cy4uLiBzbyB3ZSBkb24ndCBuZWVkIGEgbmV3IG9uZVxuICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgfVxufSk7XG5cbm1vZHVsZS5leHBvcnRzID0gU3RyYXRlZ3k7XG4iLCIndXNlIHN0cmljdCc7XG52YXIgY2xhc3NGcm9tID0gcmVxdWlyZSgnLi4vLi4vdXRpbC9pbmhlcml0Jyk7XG52YXIgQ29uZGl0aW9uYWxTdHJhdGVneSA9IHJlcXVpcmUoJy4vY29uZGl0aW9uYWwtY3JlYXRpb24tc3RyYXRlZ3knKTtcblxudmFyIF9fc3VwZXIgPSBDb25kaXRpb25hbFN0cmF0ZWd5LnByb3RvdHlwZTtcblxudmFyIFN0cmF0ZWd5ID0gY2xhc3NGcm9tKENvbmRpdGlvbmFsU3RyYXRlZ3ksIHtcbiAgICBjb25zdHJ1Y3RvcjogZnVuY3Rpb24gKHJ1blNlcnZpY2UsIG9wdGlvbnMpIHtcbiAgICAgICAgX19zdXBlci5jb25zdHJ1Y3Rvci5jYWxsKHRoaXMsIHJ1blNlcnZpY2UsIHRoaXMuY3JlYXRlSWYsIG9wdGlvbnMpO1xuICAgIH0sXG5cbiAgICBjcmVhdGVJZjogZnVuY3Rpb24gKHJ1biwgaGVhZGVycykge1xuICAgICAgICByZXR1cm4gaGVhZGVycy5nZXRSZXNwb25zZUhlYWRlcigncHJhZ21hJykgPT09ICdwZXJzaXN0ZW50JztcbiAgICB9XG59KTtcblxubW9kdWxlLmV4cG9ydHMgPSBTdHJhdGVneTtcbiIsIid1c2Ugc3RyaWN0JztcblxudmFyIGNsYXNzRnJvbSA9IHJlcXVpcmUoJy4uLy4uL3V0aWwvaW5oZXJpdCcpO1xudmFyIElkZW50aXR5U3RyYXRlZ3kgPSByZXF1aXJlKCcuL2lkZW50aXR5LXN0cmF0ZWd5Jyk7XG52YXIgU3RvcmFnZUZhY3RvcnkgPSByZXF1aXJlKCcuLi8uLi9zdG9yZS9zdG9yZS1mYWN0b3J5Jyk7XG52YXIgU3RhdGVBcGkgPSByZXF1aXJlKCcuLi8uLi9zZXJ2aWNlL3N0YXRlLWFwaS1hZGFwdGVyJyk7XG5cbnZhciBrZXlOYW1lcyA9IHJlcXVpcmUoJy4uL2tleS1uYW1lcycpO1xuXG52YXIgZGVmYXVsdHMgPSB7XG4gICAgc3RvcmU6IHtcbiAgICAgICAgc3luY2hyb25vdXM6IHRydWVcbiAgICB9XG59O1xuXG52YXIgU3RyYXRlZ3kgPSBjbGFzc0Zyb20oSWRlbnRpdHlTdHJhdGVneSwge1xuICAgIGNvbnN0cnVjdG9yOiBmdW5jdGlvbiBTdHJhdGVneShydW5TZXJ2aWNlLCBvcHRpb25zKSB7XG4gICAgICAgIHRoaXMucnVuID0gcnVuU2VydmljZTtcbiAgICAgICAgdGhpcy5vcHRpb25zID0gJC5leHRlbmQodHJ1ZSwge30sIGRlZmF1bHRzLCBvcHRpb25zKTtcbiAgICAgICAgdGhpcy5ydW5PcHRpb25zID0gdGhpcy5vcHRpb25zLnJ1bjtcbiAgICAgICAgdGhpcy5fc3RvcmUgPSBuZXcgU3RvcmFnZUZhY3RvcnkodGhpcy5vcHRpb25zLnN0b3JlKTtcbiAgICAgICAgdGhpcy5zdGF0ZUFwaSA9IG5ldyBTdGF0ZUFwaSgpO1xuXG4gICAgICAgIHRoaXMuX2xvYWRBbmRDaGVjayA9IHRoaXMuX2xvYWRBbmRDaGVjay5iaW5kKHRoaXMpO1xuICAgICAgICB0aGlzLl9yZXN0b3JlUnVuID0gdGhpcy5fcmVzdG9yZVJ1bi5iaW5kKHRoaXMpO1xuICAgICAgICB0aGlzLl9nZXRBbGxSdW5zID0gdGhpcy5fZ2V0QWxsUnVucy5iaW5kKHRoaXMpO1xuICAgICAgICB0aGlzLl9sb2FkUnVuID0gdGhpcy5fbG9hZFJ1bi5iaW5kKHRoaXMpO1xuICAgIH0sXG5cbiAgICByZXNldDogZnVuY3Rpb24gKHJ1blNlcnZpY2VPcHRpb25zKSB7XG4gICAgICAgIHZhciBzZXNzaW9uID0gdGhpcy5fYXV0aC5nZXRDdXJyZW50VXNlclNlc3Npb25JbmZvKCk7XG4gICAgICAgIHZhciBvcHQgPSAkLmV4dGVuZCh7XG4gICAgICAgICAgICBzY29wZTogeyBncm91cDogc2Vzc2lvbi5ncm91cElkIH1cbiAgICAgICAgfSwgdGhpcy5ydW5PcHRpb25zKTtcblxuICAgICAgICByZXR1cm4gdGhpcy5ydW5cbiAgICAgICAgICAgIC5jcmVhdGUob3B0LCBydW5TZXJ2aWNlT3B0aW9ucylcbiAgICAgICAgICAgIC50aGVuKGZ1bmN0aW9uIChydW4pIHtcbiAgICAgICAgICAgICAgICBydW4uZnJlc2hseUNyZWF0ZWQgPSB0cnVlO1xuICAgICAgICAgICAgICAgIHJldHVybiBydW47XG4gICAgICAgICAgICB9KTtcbiAgICB9LFxuXG4gICAgZ2V0UnVuOiBmdW5jdGlvbiAoKSB7XG4gICAgICAgIHJldHVybiB0aGlzLl9nZXRBbGxSdW5zKClcbiAgICAgICAgICAgIC50aGVuKHRoaXMuX2xvYWRBbmRDaGVjayk7XG4gICAgfSxcblxuICAgIF9nZXRBbGxSdW5zOiBmdW5jdGlvbiAoKSB7XG4gICAgICAgIHZhciBzZXNzaW9uID0gSlNPTi5wYXJzZSh0aGlzLl9zdG9yZS5nZXQoa2V5TmFtZXMuRVBJX1NFU1NJT05fS0VZKSB8fCAne30nKTtcbiAgICAgICAgcmV0dXJuIHRoaXMucnVuLnF1ZXJ5KHtcbiAgICAgICAgICAgICd1c2VyLmlkJzogc2Vzc2lvbi51c2VySWQgfHwgJzAwMDAnLFxuICAgICAgICAgICAgJ3Njb3BlLmdyb3VwJzogc2Vzc2lvbi5ncm91cE5hbWVcbiAgICAgICAgfSk7XG4gICAgfSxcblxuICAgIF9sb2FkQW5kQ2hlY2s6IGZ1bmN0aW9uIChydW5zKSB7XG4gICAgICAgIGlmICghcnVucyB8fCAhcnVucy5sZW5ndGgpIHtcbiAgICAgICAgICAgIHJldHVybiB0aGlzLnJlc2V0KCk7XG4gICAgICAgIH1cblxuICAgICAgICB2YXIgZGF0ZUNvbXAgPSBmdW5jdGlvbiAoYSwgYikgeyByZXR1cm4gbmV3IERhdGUoYi5kYXRlKSAtIG5ldyBEYXRlKGEuZGF0ZSk7IH07XG4gICAgICAgIHZhciBsYXRlc3RSdW4gPSBydW5zLnNvcnQoZGF0ZUNvbXApWzBdO1xuICAgICAgICB2YXIgX3RoaXMgPSB0aGlzO1xuICAgICAgICB2YXIgc2hvdWxkUmVwbGF5ID0gZmFsc2U7XG5cbiAgICAgICAgcmV0dXJuIHRoaXMucnVuLmxvYWQobGF0ZXN0UnVuLmlkLCBudWxsLCB7XG4gICAgICAgICAgICBzdWNjZXNzOiBmdW5jdGlvbiAocnVuLCBtc2csIGhlYWRlcnMpIHtcbiAgICAgICAgICAgICAgICBzaG91bGRSZXBsYXkgPSBoZWFkZXJzLmdldFJlc3BvbnNlSGVhZGVyKCdwcmFnbWEnKSA9PT0gJ3BlcnNpc3RlbnQnO1xuICAgICAgICAgICAgfVxuICAgICAgICB9KS50aGVuKGZ1bmN0aW9uIChydW4pIHtcbiAgICAgICAgICAgIHJldHVybiBzaG91bGRSZXBsYXkgPyBfdGhpcy5fcmVzdG9yZVJ1bihydW4uaWQpIDogcnVuO1xuICAgICAgICB9KTtcbiAgICB9LFxuXG4gICAgX3Jlc3RvcmVSdW46IGZ1bmN0aW9uIChydW5JZCkge1xuICAgICAgICB2YXIgX3RoaXMgPSB0aGlzO1xuICAgICAgICByZXR1cm4gdGhpcy5zdGF0ZUFwaS5yZXBsYXkoeyBydW5JZDogcnVuSWQgfSlcbiAgICAgICAgICAgIC50aGVuKGZ1bmN0aW9uIChyZXNwKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIF90aGlzLl9sb2FkUnVuKHJlc3AucnVuKTtcbiAgICAgICAgICAgIH0pO1xuICAgIH0sXG5cbiAgICBfbG9hZFJ1bjogZnVuY3Rpb24gKGlkLCBvcHRpb25zKSB7XG4gICAgICAgIHJldHVybiB0aGlzLnJ1bi5sb2FkKGlkLCBudWxsLCBvcHRpb25zKTtcbiAgICB9XG5cbn0pO1xuXG5tb2R1bGUuZXhwb3J0cyA9IFN0cmF0ZWd5O1xuIiwibW9kdWxlLmV4cG9ydHMgPSB7XG4gICAgJ25ldy1pZi1pbml0aWFsaXplZCc6IHJlcXVpcmUoJy4vbmV3LWlmLWluaXRpYWxpemVkLXN0cmF0ZWd5JyksXG4gICAgJ25ldy1pZi1wZXJzaXN0ZWQnOiByZXF1aXJlKCcuL25ldy1pZi1wZXJzaXN0ZWQtc3RyYXRlZ3knKSxcbiAgICAnbmV3LWlmLW1pc3NpbmcnOiByZXF1aXJlKCcuL25ldy1pZi1taXNzaW5nLXN0cmF0ZWd5JyksXG4gICAgJ2Fsd2F5cy1uZXcnOiByZXF1aXJlKCcuL2Fsd2F5cy1uZXctc3RyYXRlZ3knKSxcbiAgICAnbXVsdGlwbGF5ZXInOiByZXF1aXJlKCcuL211bHRpcGxheWVyLXN0cmF0ZWd5JyksXG4gICAgJ3BlcnNpc3RlbnQtc2luZ2xlLXBsYXllcic6IHJlcXVpcmUoJy4vcGVyc2lzdGVudC1zaW5nbGUtcGxheWVyLXN0cmF0ZWd5JyksXG4gICAgJ25vbmUnOiByZXF1aXJlKCcuL2lkZW50aXR5LXN0cmF0ZWd5JyksXG4gICAgJ2Jhc2UtaWYtaW5pdGlhbGl6ZWQnOiByZXF1aXJlKCcuL2Jhc2UtaWYtaW5pdGlhbGl6ZWQtc3RyYXRlZ3knKVxufTtcbiIsIid1c2Ugc3RyaWN0JztcbnZhciBSdW5TZXJ2aWNlID0gcmVxdWlyZSgnLi4vc2VydmljZS9ydW4tYXBpLXNlcnZpY2UnKTtcblxudmFyIGRlZmF1bHRzID0ge1xuICAgIHZhbGlkRmlsdGVyOiB7IHNhdmVkOiB0cnVlIH1cbn07XG5cbmZ1bmN0aW9uIFNjZW5hcmlvTWFuYWdlcihvcHRpb25zKSB7XG4gICAgdGhpcy5vcHRpb25zID0gJC5leHRlbmQodHJ1ZSwge30sIGRlZmF1bHRzLCBvcHRpb25zKTtcbiAgICB0aGlzLnJ1blNlcnZpY2UgPSB0aGlzLm9wdGlvbnMucnVuIHx8IG5ldyBSdW5TZXJ2aWNlKHRoaXMub3B0aW9ucyk7XG59XG5cblNjZW5hcmlvTWFuYWdlci5wcm90b3R5cGUgPSB7XG4gICAgZ2V0UnVuczogZnVuY3Rpb24gKGZpbHRlcikge1xuICAgICAgICB0aGlzLmZpbHRlciA9ICQuZXh0ZW5kKHRydWUsIHt9LCB0aGlzLm9wdGlvbnMudmFsaWRGaWx0ZXIsIGZpbHRlcik7XG4gICAgICAgIHJldHVybiB0aGlzLnJ1blNlcnZpY2UucXVlcnkodGhpcy5maWx0ZXIpO1xuICAgIH0sXG5cbiAgICBsb2FkVmFyaWFibGVzOiBmdW5jdGlvbiAodmFycykge1xuICAgICAgICByZXR1cm4gdGhpcy5ydW5TZXJ2aWNlLnF1ZXJ5KHRoaXMuZmlsdGVyLCB7IGluY2x1ZGU6IHZhcnMgfSk7XG4gICAgfSxcblxuICAgIHNhdmU6IGZ1bmN0aW9uIChydW4sIG1ldGEpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuX2dldFNlcnZpY2UocnVuKS5zYXZlKCQuZXh0ZW5kKHRydWUsIHt9LCB7IHNhdmVkOiB0cnVlIH0sIG1ldGEpKTtcbiAgICB9LFxuXG4gICAgYXJjaGl2ZTogZnVuY3Rpb24gKHJ1bikge1xuICAgICAgICByZXR1cm4gdGhpcy5fZ2V0U2VydmljZShydW4pLnNhdmUoeyBzYXZlZDogZmFsc2UgfSk7XG4gICAgfSxcblxuICAgIF9nZXRTZXJ2aWNlOiBmdW5jdGlvbiAocnVuKSB7XG4gICAgICAgIGlmICh0eXBlb2YgcnVuID09PSAnc3RyaW5nJykge1xuICAgICAgICAgICAgcmV0dXJuIG5ldyBSdW5TZXJ2aWNlKCQuZXh0ZW5kKHRydWUsIHt9LCAgdGhpcy5vcHRpb25zLCB7IGZpbHRlcjogcnVuIH0pKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmICh0eXBlb2YgcnVuID09PSAnb2JqZWN0JyAmJiBydW4gaW5zdGFuY2VvZiBSdW5TZXJ2aWNlKSB7XG4gICAgICAgICAgICByZXR1cm4gcnVuO1xuICAgICAgICB9XG5cbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdTYXZlIG1ldGhvZCByZXF1aXJlcyBhIHJ1biBzZXJ2aWNlIG9yIGEgcnVuSWQnKTtcbiAgICB9LFxuXG4gICAgZ2V0UnVuOiBmdW5jdGlvbiAocnVuSWQpIHtcbiAgICAgICAgcmV0dXJuIG5ldyBSdW5TZXJ2aWNlKCQuZXh0ZW5kKHRydWUsIHt9LCAgdGhpcy5vcHRpb25zLCB7IGZpbHRlcjogcnVuSWQgfSkpO1xuICAgIH1cbn07XG5cbm1vZHVsZS5leHBvcnRzID0gU2NlbmFyaW9NYW5hZ2VyO1xuXG4iLCIndXNlIHN0cmljdCc7XG5cblxubW9kdWxlLmV4cG9ydHMgPSB7XG4gICAgcmVzZXQ6IGZ1bmN0aW9uIChwYXJhbXMsIG9wdGlvbnMsIG1hbmFnZXIpIHtcbiAgICAgICAgcmV0dXJuIG1hbmFnZXIucmVzZXQob3B0aW9ucyk7XG4gICAgfVxufTtcbiIsIi8qKlxuKiAjIyBXb3JsZCBNYW5hZ2VyXG4qXG4qIEFzIGRpc2N1c3NlZCB1bmRlciB0aGUgW1dvcmxkIEFQSSBBZGFwdGVyXSguLi93b3JsZC1hcGktYWRhcHRlci8pLCBhIFtydW5dKC4uLy4uLy4uL2dsb3NzYXJ5LyNydW4pIGlzIGEgY29sbGVjdGlvbiBvZiBlbmQgdXNlciBpbnRlcmFjdGlvbnMgd2l0aCBhIHByb2plY3QgYW5kIGl0cyBtb2RlbC4gRm9yIGJ1aWxkaW5nIG11bHRpcGxheWVyIHNpbXVsYXRpb25zIHlvdSB0eXBpY2FsbHkgd2FudCBtdWx0aXBsZSBlbmQgdXNlcnMgdG8gc2hhcmUgdGhlIHNhbWUgc2V0IG9mIGludGVyYWN0aW9ucywgYW5kIHdvcmsgd2l0aGluIGEgY29tbW9uIHN0YXRlLiBFcGljZW50ZXIgYWxsb3dzIHlvdSB0byBjcmVhdGUgXCJ3b3JsZHNcIiB0byBoYW5kbGUgc3VjaCBjYXNlcy5cbipcbiogVGhlIFtXb3JsZCBBUEkgQWRhcHRlcl0oLi4vd29ybGQtYXBpLWFkYXB0ZXIvKSBoYW5kbGVzIGNyZWF0aW5nIG11bHRpcGxheWVyIHdvcmxkcywgYW5kIGFkZGluZyBhbmQgcmVtb3ZpbmcgZW5kIHVzZXJzIGFuZCBydW5zIGZyb20gYSB3b3JsZC5cbipcbiogVGhlIFdvcmxkIE1hbmFnZXIgcHJvdmlkZXMgYW4gZWFzeSB3YXkgdG8gdHJhY2sgYW5kIGFjY2VzcyB0aGUgY3VycmVudCB3b3JsZCBhbmQgcnVuIGZvciBwYXJ0aWN1bGFyIGVuZCB1c2Vycy5cbipcbiogIyMjIFVzaW5nIHRoZSBXb3JsZCBNYW5hZ2VyXG4qXG4qIFRvIHVzZSB0aGUgV29ybGQgTWFuYWdlciwgaW5zdGFudGlhdGUgaXQuIFRoZW4sIG1ha2UgY2FsbHMgdG8gYW55IG9mIHRoZSBtZXRob2RzIHlvdSBuZWVkOlxuKlxuKiAgICAgICB2YXIgd01nciA9IG5ldyBGLm1hbmFnZXIuV29ybGRNYW5hZ2VyKClcbiogICAgICAgd01nci5nZXRDdXJyZW50V29ybGQoKTtcbiogICAgICAgd01nci5nZXRDdXJyZW50UnVuKCk7XG4qXG4qIE5vdGUgdGhhdCB0aGUgV29ybGQgTWFuYWdlciBkb2VzICpub3QqIGNyZWF0ZSB3b3JsZHMgYXV0b21hdGljYWxseS4gKFRoaXMgaXMgZGlmZmVyZW50IHRoYW4gdGhlIFtSdW4gTWFuYWdlcl0oLi4vcnVuLW1hbmFnZXIpLikgSG93ZXZlciwgeW91IGNhbiBwYXNzIGluIHNwZWNpZmljIG9wdGlvbnMgdG8gYW55IHJ1bnMgY3JlYXRlZCBieSB0aGUgbWFuYWdlciwgdXNpbmcgYSBgcnVuYCBvYmplY3QuXG4qXG4qIFdoZW4geW91IGluc3RhbnRpYXRlIGEgV29ybGQgTWFuYWdlciwgdGhlIHdvcmxkJ3MgYWNjb3VudCBpZCwgcHJvamVjdCBpZCwgYW5kIGdyb3VwIGFyZSBhdXRvbWF0aWNhbGx5IHRha2VuIGZyb20gdGhlIHNlc3Npb24gKHRoYW5rcyB0byB0aGUgW0F1dGhlbnRpY2F0aW9uIFNlcnZpY2VdKC4uL2F1dGgtYXBpLXNlcnZpY2UpKS4gSG93ZXZlciwgeW91IGNhbiBvdmVycmlkZSB0aGVzZSBieSBvcHRpb25hbGx5IHBhc3NpbmcgaW46XG4qXG4qICAgKiBgYWNjb3VudGA6IFRoZSAqKlRlYW0gSUQqKiBpbiB0aGUgRXBpY2VudGVyIHVzZXIgaW50ZXJmYWNlIGZvciB0aGlzIHByb2plY3QuXG4qICAgKiBgcHJvamVjdGA6IFRoZSAqKlByb2plY3QgSUQqKiBmb3IgdGhpcyBwcm9qZWN0LlxuKiAgICogYGdyb3VwYDogVGhlICoqR3JvdXAgTmFtZSoqIGZvciB0aGlzIHdvcmxkLlxuKiAgICogYHJ1bmA6IE9wdGlvbnMgdG8gdXNlIHdoZW4gY3JlYXRpbmcgbmV3IHJ1bnMgd2l0aCB0aGUgbWFuYWdlciwgZS5nLiBgcnVuOiB7ZmlsZXM6IFsnZGF0YS54bHMnXX1gLlxuKlxuKiBGb3IgZXhhbXBsZTpcbipcbiogICAgICAgdmFyIHdNZ3IgPSBuZXcgRi5tYW5hZ2VyLldvcmxkTWFuYWdlcih7XG4qICAgICAgICAgIGFjY291bnQ6ICdhY21lLXNpbXVsYXRpb25zJyxcbiogICAgICAgICAgcHJvamVjdDogJ3N1cHBseS1jaGFpbi1nYW1lJyxcbiogICAgICAgICAgZ3JvdXA6ICd0ZWFtMSdcbiogICAgICAgfSk7XG4qXG4qL1xuXG4ndXNlIHN0cmljdCc7XG5cbnZhciBXb3JsZEFwaSA9IHJlcXVpcmUoJy4uL3NlcnZpY2Uvd29ybGQtYXBpLWFkYXB0ZXInKTtcbnZhciBSdW5NYW5hZ2VyID0gIHJlcXVpcmUoJy4vcnVuLW1hbmFnZXInKTtcbnZhciBBdXRoTWFuYWdlciA9IHJlcXVpcmUoJy4vYXV0aC1tYW5hZ2VyJyk7XG52YXIgd29ybGRBcGk7XG5cbi8vIHZhciBkZWZhdWx0cyA9IHtcbi8vICBhY2NvdW50OiAnJyxcbi8vICBwcm9qZWN0OiAnJyxcbi8vICBncm91cDogJycsXG4vLyAgdHJhbnNwb3J0OiB7XG4vLyAgfVxuLy8gfTtcblxuXG5mdW5jdGlvbiBidWlsZFN0cmF0ZWd5KHdvcmxkSWQsIGR0ZCkge1xuXG4gICAgcmV0dXJuIGZ1bmN0aW9uIEN0b3IocnVuU2VydmljZSwgb3B0aW9ucykge1xuICAgICAgICB0aGlzLnJ1blNlcnZpY2UgPSBydW5TZXJ2aWNlO1xuICAgICAgICB0aGlzLm9wdGlvbnMgPSBvcHRpb25zO1xuXG4gICAgICAgICQuZXh0ZW5kKHRoaXMsIHtcbiAgICAgICAgICAgIHJlc2V0OiBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdub3QgaW1wbGVtZW50ZC4gTmVlZCBhcGkgY2hhbmdlcycpO1xuICAgICAgICAgICAgfSxcblxuICAgICAgICAgICAgZ2V0UnVuOiBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICAgICAgdmFyIF90aGlzID0gdGhpcztcbiAgICAgICAgICAgICAgICAvL2dldCBvciBjcmVhdGUhXG4gICAgICAgICAgICAgICAgLy8gTW9kZWwgaXMgcmVxdWlyZWQgaW4gdGhlIG9wdGlvbnNcbiAgICAgICAgICAgICAgICByZXR1cm4gd29ybGRBcGkuZ2V0Q3VycmVudFJ1bklkKHsgbW9kZWw6IHRoaXMub3B0aW9ucy5ydW4ubW9kZWwsIGZpbHRlcjogd29ybGRJZCB9KVxuICAgICAgICAgICAgICAgICAgICAudGhlbihmdW5jdGlvbiAocnVuSWQpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHJldHVybiBfdGhpcy5ydW5TZXJ2aWNlLmxvYWQocnVuSWQpO1xuICAgICAgICAgICAgICAgICAgICB9KVxuICAgICAgICAgICAgICAgICAgICAudGhlbihmdW5jdGlvbiAocnVuKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBkdGQucmVzb2x2ZS5jYWxsKHRoaXMsIHJ1biwgX3RoaXMucnVuU2VydmljZSk7XG4gICAgICAgICAgICAgICAgICAgIH0pXG4gICAgICAgICAgICAgICAgICAgIC5mYWlsKGR0ZC5yZWplY3QpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgKTtcbiAgICB9O1xufVxuXG5cbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24gKG9wdGlvbnMpIHtcbiAgICB0aGlzLm9wdGlvbnMgPSBvcHRpb25zIHx8IHsgcnVuOiB7fSwgd29ybGQ6IHt9IH07XG5cbiAgICAkLmV4dGVuZCh0cnVlLCB0aGlzLm9wdGlvbnMsIHRoaXMub3B0aW9ucy5ydW4pO1xuICAgICQuZXh0ZW5kKHRydWUsIHRoaXMub3B0aW9ucywgdGhpcy5vcHRpb25zLndvcmxkKTtcblxuICAgIHdvcmxkQXBpID0gbmV3IFdvcmxkQXBpKHRoaXMub3B0aW9ucyk7XG4gICAgdGhpcy5fYXV0aCA9IG5ldyBBdXRoTWFuYWdlcigpO1xuICAgIHZhciBfdGhpcyA9IHRoaXM7XG5cbiAgICB2YXIgYXBpID0ge1xuXG4gICAgICAgIC8qKlxuICAgICAgICAqIFJldHVybnMgdGhlIGN1cnJlbnQgd29ybGQgKG9iamVjdCkgYW5kIGFuIGluc3RhbmNlIG9mIHRoZSBbV29ybGQgQVBJIEFkYXB0ZXJdKC4uL3dvcmxkLWFwaS1hZGFwdGVyLykuXG4gICAgICAgICpcbiAgICAgICAgKiAqKkV4YW1wbGUqKlxuICAgICAgICAqXG4gICAgICAgICogICAgICAgdmFyIHdNZ3IgPSBuZXcgRi5tYW5hZ2VyLldvcmxkTWFuYWdlcigpXG4gICAgICAgICogICAgICAgd01nci5nZXRDdXJyZW50V29ybGQoKVxuICAgICAgICAqICAgICAgICAgICAudGhlbihmdW5jdGlvbih3b3JsZCwgd29ybGRBZGFwdGVyKSB7XG4gICAgICAgICogICAgICAgICAgICAgICBjb25zb2xlLmxvZyh3b3JsZC5pZCk7XG4gICAgICAgICogICAgICAgICAgICAgICB3b3JsZEFkYXB0ZXIuZ2V0Q3VycmVudFJ1bklkKCk7XG4gICAgICAgICogICAgICAgICAgIH0pO1xuICAgICAgICAqXG4gICAgICAgICogKipQYXJhbWV0ZXJzKipcbiAgICAgICAgKiBAcGFyYW0ge3N0cmluZ30gYHVzZXJJZGAgKE9wdGlvbmFsKSBUaGUgaWQgb2YgdGhlIHVzZXIgd2hvc2Ugd29ybGQgaXMgYmVpbmcgYWNjZXNzZWQuIERlZmF1bHRzIHRvIHRoZSB1c2VyIGluIHRoZSBjdXJyZW50IHNlc3Npb24uXG4gICAgICAgICogQHBhcmFtIHtzdHJpbmd9IGBncm91cE5hbWVgIChPcHRpb25hbCkgVGhlIG5hbWUgb2YgdGhlIGdyb3VwIHdob3NlIHdvcmxkIGlzIGJlaW5nIGFjY2Vzc2VkLiBEZWZhdWx0cyB0byB0aGUgZ3JvdXAgZm9yIHRoZSB1c2VyIGluIHRoZSBjdXJyZW50IHNlc3Npb24uXG4gICAgICAgICovXG4gICAgICAgIGdldEN1cnJlbnRXb3JsZDogZnVuY3Rpb24gKHVzZXJJZCwgZ3JvdXBOYW1lKSB7XG4gICAgICAgICAgICB2YXIgc2Vzc2lvbiA9IHRoaXMuX2F1dGguZ2V0Q3VycmVudFVzZXJTZXNzaW9uSW5mbygpO1xuICAgICAgICAgICAgaWYgKCF1c2VySWQpIHtcbiAgICAgICAgICAgICAgICB1c2VySWQgPSBzZXNzaW9uLnVzZXJJZDtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlmICghZ3JvdXBOYW1lKSB7XG4gICAgICAgICAgICAgICAgZ3JvdXBOYW1lID0gc2Vzc2lvbi5ncm91cE5hbWU7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICByZXR1cm4gd29ybGRBcGkuZ2V0Q3VycmVudFdvcmxkRm9yVXNlcih1c2VySWQsIGdyb3VwTmFtZSk7XG4gICAgICAgIH0sXG5cbiAgICAgICAgLyoqXG4gICAgICAgICogUmV0dXJucyB0aGUgY3VycmVudCBydW4gKG9iamVjdCkgYW5kIGFuIGluc3RhbmNlIG9mIHRoZSBbUnVuIEFQSSBTZXJ2aWNlXSguLi9ydW4tYXBpLXNlcnZpY2UvKS5cbiAgICAgICAgKlxuICAgICAgICAqICoqRXhhbXBsZSoqXG4gICAgICAgICpcbiAgICAgICAgKiAgICAgICB2YXIgd01nciA9IG5ldyBGLm1hbmFnZXIuV29ybGRNYW5hZ2VyKClcbiAgICAgICAgKiAgICAgICB3TWdyLmdldEN1cnJlbnRSdW4oKVxuICAgICAgICAqICAgICAgICAgICAudGhlbihmdW5jdGlvbihydW4sIHJ1blNlcnZpY2UpIHtcbiAgICAgICAgKiAgICAgICAgICAgICAgIGNvbnNvbGUubG9nKHJ1bi5pZCk7XG4gICAgICAgICogICAgICAgICAgICAgICBydW5TZXJ2aWNlLmRvKCdydW5Nb2RlbCcpO1xuICAgICAgICAqICAgICAgICAgICB9KTtcbiAgICAgICAgKlxuICAgICAgICAqICoqUGFyYW1ldGVycyoqXG4gICAgICAgICogQHBhcmFtIHtzdHJpbmd9IGBtb2RlbGAgVGhlIG5hbWUgb2YgdGhlIG1vZGVsIGZpbGUuXG4gICAgICAgICovXG4gICAgICAgIGdldEN1cnJlbnRSdW46IGZ1bmN0aW9uIChtb2RlbCkge1xuICAgICAgICAgICAgdmFyIGR0ZCA9ICQuRGVmZXJyZWQoKTtcbiAgICAgICAgICAgIHZhciBzZXNzaW9uID0gdGhpcy5fYXV0aC5nZXRDdXJyZW50VXNlclNlc3Npb25JbmZvKCk7XG4gICAgICAgICAgICB2YXIgY3VyVXNlcklkID0gc2Vzc2lvbi51c2VySWQ7XG4gICAgICAgICAgICB2YXIgY3VyR3JvdXBOYW1lID0gc2Vzc2lvbi5ncm91cE5hbWU7XG5cbiAgICAgICAgICAgIGZ1bmN0aW9uIGdldEFuZFJlc3RvcmVMYXRlc3RSdW4od29ybGQpIHtcbiAgICAgICAgICAgICAgICBpZiAoIXdvcmxkKSB7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybiBkdGQucmVqZWN0KHsgZXJyb3I6ICdUaGUgdXNlciBpcyBub3QgcGFydCBvZiBhbnkgd29ybGQhJyB9KTtcbiAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICB2YXIgY3VycmVudFdvcmxkSWQgPSB3b3JsZC5pZDtcbiAgICAgICAgICAgICAgICB2YXIgcnVuT3B0cyA9ICQuZXh0ZW5kKHRydWUsIF90aGlzLm9wdGlvbnMsIHsgbW9kZWw6IG1vZGVsIH0pO1xuICAgICAgICAgICAgICAgIHZhciBzdHJhdGVneSA9IGJ1aWxkU3RyYXRlZ3koY3VycmVudFdvcmxkSWQsIGR0ZCk7XG4gICAgICAgICAgICAgICAgdmFyIG9wdCA9ICQuZXh0ZW5kKHRydWUsIHt9LCB7XG4gICAgICAgICAgICAgICAgICAgIHN0cmF0ZWd5OiBzdHJhdGVneSxcbiAgICAgICAgICAgICAgICAgICAgcnVuOiBydW5PcHRzXG4gICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAgICAgdmFyIHJtID0gbmV3IFJ1bk1hbmFnZXIob3B0KTtcblxuICAgICAgICAgICAgICAgIHJldHVybiBybS5nZXRSdW4oKVxuICAgICAgICAgICAgICAgICAgICAudGhlbihmdW5jdGlvbiAocnVuKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBkdGQucmVzb2x2ZShydW4sIHJtLnJ1blNlcnZpY2UsIHJtKTtcbiAgICAgICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIHRoaXMuZ2V0Q3VycmVudFdvcmxkKGN1clVzZXJJZCwgY3VyR3JvdXBOYW1lKVxuICAgICAgICAgICAgICAgIC50aGVuKGdldEFuZFJlc3RvcmVMYXRlc3RSdW4pO1xuXG4gICAgICAgICAgICByZXR1cm4gZHRkLnByb21pc2UoKTtcbiAgICAgICAgfVxuICAgIH07XG5cbiAgICAkLmV4dGVuZCh0aGlzLCBhcGkpO1xufTtcbiIsIi8qKlxuICpcbiAqICMjQXV0aGVudGljYXRpb24gQVBJIFNlcnZpY2VcbiAqXG4gKiBUaGUgQXV0aGVudGljYXRpb24gQVBJIFNlcnZpY2UgcHJvdmlkZXMgbWV0aG9kcyBmb3IgbG9nZ2luZyBpbiBhbmQgbG9nZ2luZyBvdXQuIE9uIGxvZ2luLCB0aGlzIHNlcnZpY2UgY3JlYXRlcyBhbmQgcmV0dXJucyBhIHVzZXIgYWNjZXNzIHRva2VuLlxuICpcbiAqIFVzZXIgYWNjZXNzIHRva2VucyBhcmUgcmVxdWlyZWQgZm9yIGVhY2ggY2FsbCB0byBFcGljZW50ZXIuIChTZWUgW1Byb2plY3QgQWNjZXNzXSguLi8uLi8uLi9wcm9qZWN0X2FjY2Vzcy8pIGZvciBtb3JlIGluZm9ybWF0aW9uLilcbiAqXG4gKiBJZiB5b3UgbmVlZCBhZGRpdGlvbmFsIGZ1bmN0aW9uYWxpdHkgLS0gc3VjaCBhcyB0cmFja2luZyBzZXNzaW9uIGluZm9ybWF0aW9uLCBlYXNpbHkgcmV0cmlldmluZyB0aGUgdXNlciB0b2tlbiwgb3IgZ2V0dGluZyB0aGUgZ3JvdXBzIHRvIHdoaWNoIGFuIGVuZCB1c2VyIGJlbG9uZ3MgLS0gY29uc2lkZXIgdXNpbmcgdGhlIFtBdXRob3JpemF0aW9uIE1hbmFnZXJdKC4uL2F1dGgtbWFuYWdlci8pIGluc3RlYWQuXG4gKlxuICogICAgICB2YXIgYXV0aCA9IG5ldyBGLnNlcnZpY2UuQXV0aCgpO1xuICogICAgICBhdXRoLmxvZ2luKHsgdXNlck5hbWU6ICdqc21pdGhAYWNtZXNpbXVsYXRpb25zLmNvbScsXG4gKiAgICAgICAgICAgICAgICAgIHBhc3N3b3JkOiAncGFzc3cwcmQnIH0pO1xuICogICAgICBhdXRoLmxvZ291dCgpO1xuICovXG5cbid1c2Ugc3RyaWN0JztcblxudmFyIENvbmZpZ1NlcnZpY2UgPSByZXF1aXJlKCcuL2NvbmZpZ3VyYXRpb24tc2VydmljZScpO1xudmFyIFRyYW5zcG9ydEZhY3RvcnkgPSByZXF1aXJlKCcuLi90cmFuc3BvcnQvaHR0cC10cmFuc3BvcnQtZmFjdG9yeScpO1xuXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uIChjb25maWcpIHtcbiAgICB2YXIgZGVmYXVsdHMgPSB7XG4gICAgICAgIC8qKlxuICAgICAgICAgKiBFbWFpbCBvciB1c2VybmFtZSB0byB1c2UgZm9yIGxvZ2dpbmcgaW4uIERlZmF1bHRzIHRvIGVtcHR5IHN0cmluZy5cbiAgICAgICAgICogQHR5cGUge1N0cmluZ31cbiAgICAgICAgICovXG4gICAgICAgIHVzZXJOYW1lOiAnJyxcblxuICAgICAgICAvKipcbiAgICAgICAgICogUGFzc3dvcmQgZm9yIHNwZWNpZmllZCBgdXNlck5hbWVgLiBEZWZhdWx0cyB0byBlbXB0eSBzdHJpbmcuXG4gICAgICAgICAqIEB0eXBlIHtTdHJpbmd9XG4gICAgICAgICAqL1xuICAgICAgICBwYXNzd29yZDogJycsXG5cbiAgICAgICAgLyoqXG4gICAgICAgICAqIFRoZSBhY2NvdW50IGlkIGZvciB0aGlzIGB1c2VyTmFtZWAuIEluIHRoZSBFcGljZW50ZXIgVUksIHRoaXMgaXMgdGhlICoqVGVhbSBJRCoqIChmb3IgdGVhbSBwcm9qZWN0cykgb3IgdGhlICoqVXNlciBJRCoqIChmb3IgcGVyc29uYWwgcHJvamVjdHMpLiBSZXF1aXJlZCBpZiB0aGUgYHVzZXJOYW1lYCBpcyBmb3IgYW4gW2VuZCB1c2VyXSguLi8uLi8uLi9nbG9zc2FyeS8jdXNlcnMpLiBEZWZhdWx0cyB0byBlbXB0eSBzdHJpbmcuXG4gICAgICAgICAqIEB0eXBlIHtTdHJpbmd9XG4gICAgICAgICAqL1xuICAgICAgICBhY2NvdW50OiAnJyxcblxuICAgICAgICAvKipcbiAgICAgICAgICogT3B0aW9ucyB0byBwYXNzIG9uIHRvIHRoZSB1bmRlcmx5aW5nIHRyYW5zcG9ydCBsYXllci4gQWxsIGpxdWVyeS5hamF4IG9wdGlvbnMgYXQgaHR0cDovL2FwaS5qcXVlcnkuY29tL2pRdWVyeS5hamF4LyBhcmUgYXZhaWxhYmxlLiBEZWZhdWx0cyB0byBlbXB0eSBvYmplY3QuXG4gICAgICAgICAqIEB0eXBlIHtPYmplY3R9XG4gICAgICAgICAqL1xuICAgICAgICB0cmFuc3BvcnQ6IHt9XG4gICAgfTtcbiAgICB2YXIgc2VydmljZU9wdGlvbnMgPSAkLmV4dGVuZCh7fSwgZGVmYXVsdHMsIGNvbmZpZyk7XG4gICAgdmFyIHVybENvbmZpZyA9IG5ldyBDb25maWdTZXJ2aWNlKHNlcnZpY2VPcHRpb25zKS5nZXQoJ3NlcnZlcicpO1xuXG4gICAgdmFyIHRyYW5zcG9ydE9wdGlvbnMgPSAkLmV4dGVuZCh0cnVlLCB7fSwgc2VydmljZU9wdGlvbnMudHJhbnNwb3J0LCB7XG4gICAgICAgIHVybDogdXJsQ29uZmlnLmdldEFQSVBhdGgoJ2F1dGhlbnRpY2F0aW9uJylcbiAgICB9KTtcbiAgICB2YXIgaHR0cCA9IG5ldyBUcmFuc3BvcnRGYWN0b3J5KHRyYW5zcG9ydE9wdGlvbnMpO1xuXG4gICAgdmFyIHB1YmxpY0FQSSA9IHtcblxuICAgICAgICAvKipcbiAgICAgICAgICogTG9ncyB1c2VyIGluLCByZXR1cm5pbmcgdGhlIHVzZXIgYWNjZXNzIHRva2VuLlxuICAgICAgICAgKlxuICAgICAgICAgKiBJZiBubyBgdXNlck5hbWVgIG9yIGBwYXNzd29yZGAgd2VyZSBwcm92aWRlZCBpbiB0aGUgaW5pdGlhbCBjb25maWd1cmF0aW9uIG9wdGlvbnMsIHRoZXkgYXJlIHJlcXVpcmVkIGluIHRoZSBgb3B0aW9uc2AgaGVyZS4gSWYgbm8gYGFjY291bnRgIHdhcyBwcm92aWRlZCBpbiB0aGUgaW5pdGlhbCBjb25maWd1cmF0aW9uIG9wdGlvbnMgYW5kIHRoZSBgdXNlck5hbWVgIGlzIGZvciBhbiBbZW5kIHVzZXJdKC4uLy4uLy4uL2dsb3NzYXJ5LyN1c2VycyksIHRoZSBgYWNjb3VudGAgaXMgcmVxdWlyZWQgYXMgd2VsbC5cbiAgICAgICAgICpcbiAgICAgICAgICogKipFeGFtcGxlKipcbiAgICAgICAgICpcbiAgICAgICAgICogICAgICBhdXRoLmxvZ2luKHtcbiAgICAgICAgICogICAgICAgICAgdXNlck5hbWU6ICdqc21pdGgnLFxuICAgICAgICAgKiAgICAgICAgICBwYXNzd29yZDogJ3Bhc3N3MHJkJyxcbiAgICAgICAgICogICAgICAgICAgYWNjb3VudDogJ2FjbWUtc2ltdWxhdGlvbnMnIH0pXG4gICAgICAgICAqICAgICAgLnRoZW4oZnVuY3Rpb24gKHRva2VuKSB7XG4gICAgICAgICAqICAgICAgICAgIGNvbnNvbGUubG9nKFwidXNlciBhY2Nlc3MgdG9rZW4gaXM6IFwiLCB0b2tlbi5hY2Nlc3NfdG9rZW4pO1xuICAgICAgICAgKiAgICAgIH0pO1xuICAgICAgICAgKlxuICAgICAgICAgKiAqKlBhcmFtZXRlcnMqKlxuICAgICAgICAgKiBAcGFyYW0ge09iamVjdH0gYG9wdGlvbnNgIChPcHRpb25hbCkgT3ZlcnJpZGVzIGZvciBjb25maWd1cmF0aW9uIG9wdGlvbnMuXG4gICAgICAgICAqL1xuICAgICAgICBsb2dpbjogZnVuY3Rpb24gKG9wdGlvbnMpIHtcbiAgICAgICAgICAgIHZhciBodHRwT3B0aW9ucyA9ICQuZXh0ZW5kKHRydWUsIHsgc3VjY2VzczogJC5ub29wIH0sIHNlcnZpY2VPcHRpb25zLCBvcHRpb25zKTtcbiAgICAgICAgICAgIGlmICghaHR0cE9wdGlvbnMudXNlck5hbWUgfHwgIWh0dHBPcHRpb25zLnBhc3N3b3JkKSB7XG4gICAgICAgICAgICAgICAgdmFyIHJlc3AgPSB7IHN0YXR1czogNDAxLCBzdGF0dXNNZXNzYWdlOiAnTm8gdXNlcm5hbWUgb3IgcGFzc3dvcmQgc3BlY2lmaWVkLicgfTtcbiAgICAgICAgICAgICAgICBpZiAob3B0aW9ucy5lcnJvcikge1xuICAgICAgICAgICAgICAgICAgICBvcHRpb25zLmVycm9yLmNhbGwodGhpcywgcmVzcCk7XG4gICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgcmV0dXJuICQuRGVmZXJyZWQoKS5yZWplY3QocmVzcCkucHJvbWlzZSgpO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICB2YXIgcG9zdFBhcmFtcyA9IHtcbiAgICAgICAgICAgICAgICB1c2VyTmFtZTogaHR0cE9wdGlvbnMudXNlck5hbWUsXG4gICAgICAgICAgICAgICAgcGFzc3dvcmQ6IGh0dHBPcHRpb25zLnBhc3N3b3JkLFxuICAgICAgICAgICAgfTtcbiAgICAgICAgICAgIGlmIChodHRwT3B0aW9ucy5hY2NvdW50KSB7XG4gICAgICAgICAgICAgICAgLy9wYXNzIGluIG51bGwgZm9yIGFjY291bnQgdW5kZXIgb3B0aW9ucyBpZiB5b3UgZG9uJ3Qgd2FudCBpdCB0byBiZSBzZW50XG4gICAgICAgICAgICAgICAgcG9zdFBhcmFtcy5hY2NvdW50ID0gaHR0cE9wdGlvbnMuYWNjb3VudDtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgcmV0dXJuIGh0dHAucG9zdChwb3N0UGFyYW1zLCBodHRwT3B0aW9ucyk7XG4gICAgICAgIH0sXG5cbiAgICAgICAgLyoqXG4gICAgICAgICAqIExvZ3MgdXNlciBvdXQgZnJvbSBzcGVjaWZpZWQgYWNjb3VudHMuXG4gICAgICAgICAqXG4gICAgICAgICAqICoqRXhhbXBsZSoqXG4gICAgICAgICAqXG4gICAgICAgICAqICAgICAgYXV0aC5sb2dvdXQoKTtcbiAgICAgICAgICpcbiAgICAgICAgICogKipQYXJhbWV0ZXJzKipcbiAgICAgICAgICogQHBhcmFtIHtPYmplY3R9IGBvcHRpb25zYCAoT3B0aW9uYWwpIE92ZXJyaWRlcyBmb3IgY29uZmlndXJhdGlvbiBvcHRpb25zLlxuICAgICAgICAgKi9cbiAgICAgICAgbG9nb3V0OiBmdW5jdGlvbiAob3B0aW9ucykge1xuICAgICAgICAgICAgdmFyIGh0dHBPcHRpb25zID0gJC5leHRlbmQodHJ1ZSwgc2VydmljZU9wdGlvbnMsIHRyYW5zcG9ydE9wdGlvbnMsIG9wdGlvbnMpO1xuICAgICAgICAgICAgaWYgKCFodHRwT3B0aW9ucy50b2tlbikge1xuICAgICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcignTm8gdG9rZW4gd2FzIHNwZWNpZmllZC4nKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHZhciBzbGFzaCA9IGh0dHBPcHRpb25zLnVybC5zbGljZSgtMSkgPT09ICcvJyA/ICcnIDogJy8nO1xuICAgICAgICAgICAgaHR0cE9wdGlvbnMudXJsID0gaHR0cE9wdGlvbnMudXJsICsgc2xhc2ggKyBodHRwT3B0aW9ucy50b2tlbjtcbiAgICAgICAgICAgIHZhciBkZWxldGVQYXJhbXMgPSB7fTtcblxuICAgICAgICAgICAgcmV0dXJuIGh0dHAuZGVsZXRlKGRlbGV0ZVBhcmFtcywgaHR0cE9wdGlvbnMpO1xuICAgICAgICB9XG4gICAgfTtcblxuICAgICQuZXh0ZW5kKHRoaXMsIHB1YmxpY0FQSSk7XG59O1xuIiwiJ3VzZSBzdHJpY3QnO1xuXG4vKipcbiAqICMjIENoYW5uZWwgU2VydmljZVxuICpcbiAqIFRoZSBFcGljZW50ZXIgcGxhdGZvcm0gcHJvdmlkZXMgYSBwdXNoIGNoYW5uZWwsIHdoaWNoIGFsbG93cyB5b3UgdG8gcHVibGlzaCBhbmQgc3Vic2NyaWJlIHRvIG1lc3NhZ2VzIHdpdGhpbiBhIFtwcm9qZWN0XSguLi8uLi8uLi9nbG9zc2FyeS8jcHJvamVjdHMpLCBbZ3JvdXBdKC4uLy4uLy4uL2dsb3NzYXJ5LyNncm91cHMpLCBvciBbbXVsdGlwbGF5ZXIgd29ybGRdKC4uLy4uLy4uL2dsb3NzYXJ5LyN3b3JsZCkuIFRoZXJlIGFyZSB0d28gbWFpbiB1c2UgY2FzZXMgZm9yIHRoZSBjaGFubmVsOiBldmVudCBub3RpZmljYXRpb25zIGFuZCBjaGF0IG1lc3NhZ2VzLlxuICpcbiAqIFRoZSBDaGFubmVsIFNlcnZpY2UgaXMgYSBidWlsZGluZyBibG9jayBmb3IgdGhpcyBmdW5jdGlvbmFsaXR5LiBJdCBjcmVhdGVzIGEgcHVibGlzaC1zdWJzY3JpYmUgb2JqZWN0LCBhbGxvd2luZyB5b3UgdG8gcHVibGlzaCBtZXNzYWdlcywgc3Vic2NyaWJlIHRvIG1lc3NhZ2VzLCBvciB1bnN1YnNjcmliZSBmcm9tIG1lc3NhZ2VzIGZvciBhIGdpdmVuICd0b3BpYycgb24gYSBgJC5jb21ldGRgIHRyYW5zcG9ydCBpbnN0YW5jZS5cbiAqXG4gKiBUeXBpY2FsbHksIHlvdSB1c2UgdGhlIFtFcGljZW50ZXIgQ2hhbm5lbCBNYW5hZ2VyXSguLi9lcGljZW50ZXItY2hhbm5lbC1tYW5hZ2VyLykgdG8gY3JlYXRlIG9yIHJldHJpZXZlIGNoYW5uZWxzLCB0aGVuIHVzZSB0aGUgQ2hhbm5lbCBTZXJ2aWNlIGBzdWJzY3JpYmUoKWAgYW5kIGBwdWJsaXNoKClgIG1ldGhvZHMgdG8gbGlzdGVuIHRvIG9yIHVwZGF0ZSBkYXRhLiAoRm9yIGFkZGl0aW9uYWwgYmFja2dyb3VuZCBvbiBFcGljZW50ZXIncyBwdXNoIGNoYW5uZWwsIHNlZSB0aGUgaW50cm9kdWN0b3J5IG5vdGVzIG9uIHRoZSBbUHVzaCBDaGFubmVsIEFQSV0oLi4vLi4vLi4vcmVzdF9hcGlzL211bHRpcGxheWVyL2NoYW5uZWwvKSBwYWdlLilcbiAqXG4gKiBZb3UnbGwgbmVlZCB0byBpbmNsdWRlIHRoZSBgZXBpY2VudGVyLW11bHRpcGxheWVyLWRlcGVuZGVuY2llcy5qc2AgbGlicmFyeSBpbiBhZGRpdGlvbiB0byB0aGUgYGVwaWNlbnRlci5qc2AgbGlicmFyeSBpbiB5b3VyIHByb2plY3QgdG8gdXNlIHRoZSBDaGFubmVsIFNlcnZpY2UuIChTZWUgW0luY2x1ZGluZyBFcGljZW50ZXIuanNdKC4uLy4uLyNpbmNsdWRlKS4pXG4gKlxuICogVG8gdXNlIHRoZSBDaGFubmVsIFNlcnZpY2UsIGluc3RhbnRpYXRlIGl0LCB0aGVuIG1ha2UgY2FsbHMgdG8gYW55IG9mIHRoZSBtZXRob2RzIHlvdSBuZWVkLlxuICpcbiAqICAgICAgICB2YXIgY3MgPSBuZXcgRi5zZXJ2aWNlLkNoYW5uZWwoKTtcbiAqICAgICAgICBjcy5wdWJsaXNoKCdydW4vdmFyaWFibGVzJywge3ByaWNlOiA1MH0pO1xuICpcbiAqIFRoZSBwYXJhbWV0ZXJzIGZvciBpbnN0YW50aWF0aW5nIGEgQ2hhbm5lbCBTZXJ2aWNlIGluY2x1ZGU6XG4gKlxuICogKiBgb3B0aW9uc2AgVGhlIG9wdGlvbnMgb2JqZWN0IHRvIGNvbmZpZ3VyZSB0aGUgQ2hhbm5lbCBTZXJ2aWNlLlxuICogKiBgb3B0aW9ucy5iYXNlYCBUaGUgYmFzZSB0b3BpYy4gVGhpcyBpcyBhZGRlZCBhcyBhIHByZWZpeCB0byBhbGwgZnVydGhlciB0b3BpY3MgeW91IHB1Ymxpc2ggb3Igc3Vic2NyaWJlIHRvIHdoaWxlIHdvcmtpbmcgd2l0aCB0aGlzIENoYW5uZWwgU2VydmljZS5cbiAqICogYG9wdGlvbnMudG9waWNSZXNvbHZlcmAgQSBmdW5jdGlvbiB0aGF0IHByb2Nlc3NlcyBhbGwgJ3RvcGljcycgcGFzc2VkIGludG8gdGhlIGBwdWJsaXNoYCBhbmQgYHN1YnNjcmliZWAgbWV0aG9kcy4gVGhpcyBpcyB1c2VmdWwgaWYgeW91IHdhbnQgdG8gaW1wbGVtZW50IHlvdXIgb3duIHNlcmlhbGl6ZSBmdW5jdGlvbnMgZm9yIGNvbnZlcnRpbmcgY3VzdG9tIG9iamVjdHMgdG8gdG9waWMgbmFtZXMuIFJldHVybnMgYSBTdHJpbmcuIEJ5IGRlZmF1bHQsIGl0IGp1c3QgZWNob2VzIHRoZSB0b3BpYy5cbiAqICogYG9wdGlvbnMudHJhbnNwb3J0YCBUaGUgaW5zdGFuY2Ugb2YgYCQuY29tZXRkYCB0byBob29rIG9udG8uIFNlZSBodHRwOi8vZG9jcy5jb21ldGQub3JnL3JlZmVyZW5jZS9qYXZhc2NyaXB0Lmh0bWwgZm9yIGFkZGl0aW9uYWwgYmFja2dyb3VuZCBvbiBjb21ldGQuXG4gKi9cbnZhciBDaGFubmVsID0gZnVuY3Rpb24gKG9wdGlvbnMpIHtcbiAgICB2YXIgZGVmYXVsdHMgPSB7XG5cbiAgICAgICAgLyoqXG4gICAgICAgICAqIFRoZSBiYXNlIHRvcGljLiBUaGlzIGlzIGFkZGVkIGFzIGEgcHJlZml4IHRvIGFsbCBmdXJ0aGVyIHRvcGljcyB5b3UgcHVibGlzaCBvciBzdWJzY3JpYmUgdG8gd2hpbGUgd29ya2luZyB3aXRoIHRoaXMgQ2hhbm5lbCBTZXJ2aWNlLlxuICAgICAgICAgKi9cbiAgICAgICAgYmFzZTogJycsXG5cbiAgICAgICAgLyoqXG4gICAgICAgICAqIEEgZnVuY3Rpb24gdGhhdCBwcm9jZXNzZXMgYWxsICd0b3BpY3MnIHBhc3NlZCBpbnRvIHRoZSBgcHVibGlzaGAgYW5kIGBzdWJzY3JpYmVgIG1ldGhvZHMuIFRoaXMgaXMgdXNlZnVsIGlmIHlvdSB3YW50IHRvIGltcGxlbWVudCB5b3VyIG93biBzZXJpYWxpemUgZnVuY3Rpb25zIGZvciBjb252ZXJ0aW5nIGN1c3RvbSBvYmplY3RzIHRvIHRvcGljIG5hbWVzLiBCeSBkZWZhdWx0LCBpdCBqdXN0IGVjaG9lcyB0aGUgdG9waWMuXG4gICAgICAgICAqXG4gICAgICAgICAqICoqUGFyYW1ldGVycyoqXG4gICAgICAgICAqXG4gICAgICAgICAqICogYHRvcGljYCBUb3BpYyB0byBwYXJzZS5cbiAgICAgICAgICpcbiAgICAgICAgICogKipSZXR1cm4gVmFsdWUqKlxuICAgICAgICAgKlxuICAgICAgICAgKiAqICpTdHJpbmcqOiBUaGlzIGZ1bmN0aW9uIHNob3VsZCByZXR1cm4gYSBzdHJpbmcgdG9waWMuXG4gICAgICAgICAqL1xuICAgICAgICB0b3BpY1Jlc29sdmVyOiBmdW5jdGlvbiAodG9waWMpIHtcbiAgICAgICAgICAgIHJldHVybiB0b3BpYztcbiAgICAgICAgfSxcblxuICAgICAgICAvKipcbiAgICAgICAgICogVGhlIGluc3RhbmNlIG9mIGAkLmNvbWV0ZGAgdG8gaG9vayBvbnRvLlxuICAgICAgICAgKi9cbiAgICAgICAgdHJhbnNwb3J0OiBudWxsXG4gICAgfTtcbiAgICB0aGlzLmNoYW5uZWxPcHRpb25zID0gJC5leHRlbmQodHJ1ZSwge30sIGRlZmF1bHRzLCBvcHRpb25zKTtcbn07XG5cbnZhciBtYWtlTmFtZSA9IGZ1bmN0aW9uIChjaGFubmVsTmFtZSwgdG9waWMpIHtcbiAgICAvL1JlcGxhY2UgdHJhaWxpbmcvZG91YmxlIHNsYXNoZXNcbiAgICB2YXIgbmV3TmFtZSA9IChjaGFubmVsTmFtZSA/IChjaGFubmVsTmFtZSArICcvJyArIHRvcGljKSA6IHRvcGljKS5yZXBsYWNlKC9cXC9cXC8vZywgJy8nKS5yZXBsYWNlKC9cXC8kLywnJyk7XG4gICAgcmV0dXJuIG5ld05hbWU7XG59O1xuXG5cbkNoYW5uZWwucHJvdG90eXBlID0gJC5leHRlbmQoQ2hhbm5lbC5wcm90b3R5cGUsIHtcblxuICAgIC8vIGZ1dHVyZSBmdW5jdGlvbmFsaXR5OlxuICAgIC8vICAgICAgLy8gU2V0IHRoZSBjb250ZXh0IGZvciB0aGUgY2FsbGJhY2tcbiAgICAvLyAgICAgIGNzLnN1YnNjcmliZSgncnVuJywgZnVuY3Rpb24gKCkgeyB0aGlzLmlubmVySFRNTCA9ICdUcmlnZ2VyZWQnfSwgZG9jdW1lbnQuYm9keSk7XG4gICAgIC8vXG4gICAgIC8vICAgICAgLy8gQ29udHJvbCB0aGUgb3JkZXIgb2Ygb3BlcmF0aW9ucyBieSBzZXR0aW5nIHRoZSBgcHJpb3JpdHlgXG4gICAgIC8vICAgICAgY3Muc3Vic2NyaWJlKCdydW4nLCBjYiwgdGhpcywge3ByaW9yaXR5OiA5fSk7XG4gICAgIC8vXG4gICAgIC8vICAgICAgLy8gT25seSBleGVjdXRlIHRoZSBjYWxsYmFjaywgYGNiYCwgaWYgdGhlIHZhbHVlIG9mIHRoZSBgcHJpY2VgIHZhcmlhYmxlIGlzIDUwXG4gICAgIC8vICAgICAgY3Muc3Vic2NyaWJlKCdydW4vdmFyaWFibGVzL3ByaWNlJywgY2IsIHRoaXMsIHtwcmlvcml0eTogMzAsIHZhbHVlOiA1MH0pO1xuICAgICAvL1xuICAgICAvLyAgICAgIC8vIE9ubHkgZXhlY3V0ZSB0aGUgY2FsbGJhY2ssIGBjYmAsIGlmIHRoZSB2YWx1ZSBvZiB0aGUgYHByaWNlYCB2YXJpYWJsZSBpcyBncmVhdGVyIHRoYW4gNTBcbiAgICAgLy8gICAgICBzdWJzY3JpYmUoJ3J1bi92YXJpYWJsZXMvcHJpY2UnLCBjYiwgdGhpcywge3ByaW9yaXR5OiAzMCwgdmFsdWU6ICc+NTAnfSk7XG4gICAgIC8vXG4gICAgIC8vICAgICAgLy8gT25seSBleGVjdXRlIHRoZSBjYWxsYmFjaywgYGNiYCwgaWYgdGhlIHZhbHVlIG9mIHRoZSBgcHJpY2VgIHZhcmlhYmxlIGlzIGV2ZW5cbiAgICAgLy8gICAgICBzdWJzY3JpYmUoJ3J1bi92YXJpYWJsZXMvcHJpY2UnLCBjYiwgdGhpcywge3ByaW9yaXR5OiAzMCwgdmFsdWU6IGZ1bmN0aW9uICh2YWwpIHtyZXR1cm4gdmFsICUgMiA9PT0gMH19KTtcblxuXG4gICAgLyoqXG4gICAgICogU3Vic2NyaWJlIHRvIGNoYW5nZXMgb24gYSB0b3BpYy5cbiAgICAgKlxuICAgICAqICAqKkV4YW1wbGVzKipcbiAgICAgKlxuICAgICAqICAgICAgLy8gU3Vic2NyaWJlIHRvIGNoYW5nZXMgb24gYSB0b3AtbGV2ZWwgJ3J1bicgdG9waWNcbiAgICAgKiAgICAgIGNzLnN1YnNjcmliZSgncnVuJywgY2IpO1xuICAgICAqXG4gICAgICogICAgICAvLyBTdWJzY3JpYmUgdG8gY2hhbmdlcyBvbiBjaGlsZHJlbiBvZiB0aGUgJ3J1bicgdG9waWMuIE5vdGUgdGhpcyB3aWxsIGFsc28gYmUgdHJpZ2dlcmVkIGZvciBjaGFuZ2VzIHRvIHJ1bi54Lnkuei5cbiAgICAgKiAgICAgIGNzLnN1YnNjcmliZSgncnVuLyonKTtcbiAgICAgKlxuICAgICAqICAgICAgLy8gU3Vic2NyaWJlIHRvIGNoYW5nZXMgb24gYm90aCB0aGUgdG9wLWxldmVsICdydW4nIHRvcGljIGFuZCBpdHMgY2hpbGRyZW5cbiAgICAgKiAgICAgIGNzLnN1YnNjcmliZShbJ3J1bicsICdydW4vKiddKTtcbiAgICAgKlxuICAgICAqICAgICAgLy8gU3Vic2NyaWJlIHRvIGNoYW5nZXMgb24gYSBwYXJ0aWN1bGFyIHZhcmlhYmxlXG4gICAgICogICAgICBzdWJzY3JpYmUoJ3J1bi92YXJpYWJsZXMvcHJpY2UnLCBjYik7XG4gICAgICpcbiAgICAgKlxuICAgICAqICoqUmV0dXJuIFZhbHVlKipcbiAgICAgKlxuICAgICAqICogKlN0cmluZyogUmV0dXJucyBhIHRva2VuIHlvdSBjYW4gbGF0ZXIgdXNlIHRvIHVuc3Vic2NyaWJlLlxuICAgICAqXG4gICAgICogKipQYXJhbWV0ZXJzKipcbiAgICAgKiBAcGFyYW0gIHtTdHJpbmd8QXJyYXl9ICAgYHRvcGljYCAgICBMaXN0IG9mIHRvcGljcyB0byBsaXN0ZW4gZm9yIGNoYW5nZXMgb24uXG4gICAgICogQHBhcmFtICB7RnVuY3Rpb259IGBjYWxsYmFja2AgQ2FsbGJhY2sgZnVuY3Rpb24gdG8gZXhlY3V0ZS4gQ2FsbGJhY2sgaXMgY2FsbGVkIHdpdGggc2lnbmF0dXJlIGAoZXZ0LCBwYXlsb2FkLCBtZXRhZGF0YSlgLlxuICAgICAqIEBwYXJhbSAge09iamVjdH0gICBgY29udGV4dGAgIENvbnRleHQgaW4gd2hpY2ggdGhlIGBjYWxsYmFja2AgaXMgZXhlY3V0ZWQuXG4gICAgICogQHBhcmFtICB7T2JqZWN0fSAgIGBvcHRpb25zYCAgKE9wdGlvbmFsKSBPdmVycmlkZXMgZm9yIGNvbmZpZ3VyYXRpb24gb3B0aW9ucy5cbiAgICAgKiBAcGFyYW0gIHtOdW1iZXJ9ICAgYG9wdGlvbnMucHJpb3JpdHlgICBVc2VkIHRvIGNvbnRyb2wgb3JkZXIgb2Ygb3BlcmF0aW9ucy4gRGVmYXVsdHMgdG8gMC4gQ2FuIGJlIGFueSArdmUgb3IgLXZlIG51bWJlci5cbiAgICAgKiBAcGFyYW0gIHtTdHJpbmd8TnVtYmVyfEZ1bmN0aW9ufSAgIGBvcHRpb25zLnZhbHVlYCBUaGUgYGNhbGxiYWNrYCBpcyBvbmx5IHRyaWdnZXJlZCBpZiB0aGlzIGNvbmRpdGlvbiBtYXRjaGVzLiBTZWUgZXhhbXBsZXMgZm9yIGRldGFpbHMuXG4gICAgICpcbiAgICAgKi9cbiAgICBzdWJzY3JpYmU6IGZ1bmN0aW9uICh0b3BpYywgY2FsbGJhY2ssIGNvbnRleHQsIG9wdGlvbnMpIHtcblxuICAgICAgICB2YXIgdG9waWNzID0gW10uY29uY2F0KHRvcGljKTtcbiAgICAgICAgdmFyIG1lID0gdGhpcztcbiAgICAgICAgdmFyIHN1YnNjcmlwdGlvbklkcyA9IFtdO1xuICAgICAgICB2YXIgb3B0cyA9IG1lLmNoYW5uZWxPcHRpb25zO1xuXG4gICAgICAgIG9wdHMudHJhbnNwb3J0LmJhdGNoKGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgICQuZWFjaCh0b3BpY3MsIGZ1bmN0aW9uIChpbmRleCwgdG9waWMpIHtcbiAgICAgICAgICAgICAgICB0b3BpYyA9IG1ha2VOYW1lKG9wdHMuYmFzZSwgb3B0cy50b3BpY1Jlc29sdmVyKHRvcGljKSk7XG4gICAgICAgICAgICAgICAgc3Vic2NyaXB0aW9uSWRzLnB1c2gob3B0cy50cmFuc3BvcnQuc3Vic2NyaWJlKHRvcGljLCBjYWxsYmFjaykpO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgIH0pO1xuICAgICAgICByZXR1cm4gKHN1YnNjcmlwdGlvbklkc1sxXSA/IHN1YnNjcmlwdGlvbklkcyA6IHN1YnNjcmlwdGlvbklkc1swXSk7XG4gICAgfSxcblxuICAgIC8qKlxuICAgICAqIFB1Ymxpc2ggZGF0YSB0byBhIHRvcGljLlxuICAgICAqXG4gICAgICogKipFeGFtcGxlcyoqXG4gICAgICpcbiAgICAgKiAgICAgIC8vIFNlbmQgZGF0YSB0byBhbGwgc3Vic2NyaWJlcnMgb2YgdGhlICdydW4nIHRvcGljXG4gICAgICogICAgICBjcy5wdWJsaXNoKCdydW4nLCB7Y29tcGxldGVkOiBmYWxzZX0pO1xuICAgICAqXG4gICAgICogICAgICAvLyBTZW5kIGRhdGEgdG8gYWxsIHN1YnNjcmliZXJzIG9mIHRoZSAncnVuL3ZhcmlhYmxlcycgdG9waWNcbiAgICAgKiAgICAgIGNzLnB1Ymxpc2goJ3J1bi92YXJpYWJsZXMnLCB7cHJpY2U6IDUwfSk7XG4gICAgICpcbiAgICAgKiAqKlBhcmFtZXRlcnMqKlxuICAgICAqXG4gICAgICogQHBhcmFtICB7U3RyaW5nfSBgdG9waWNgIFRvcGljIHRvIHB1Ymxpc2ggdG8uXG4gICAgICogQHBhcmFtICB7Kn0gYHBheWxvYWRgICBEYXRhIHRvIHB1Ymxpc2ggdG8gdG9waWMuXG4gICAgICpcbiAgICAgKi9cbiAgICBwdWJsaXNoOiBmdW5jdGlvbiAodG9waWMsIGRhdGEpIHtcbiAgICAgICAgdmFyIHRvcGljcyA9IFtdLmNvbmNhdCh0b3BpYyk7XG4gICAgICAgIHZhciBtZSA9IHRoaXM7XG4gICAgICAgIHZhciByZXR1cm5PYmpzID0gW107XG4gICAgICAgIHZhciBvcHRzID0gbWUuY2hhbm5lbE9wdGlvbnM7XG5cblxuICAgICAgICBvcHRzLnRyYW5zcG9ydC5iYXRjaChmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICAkLmVhY2godG9waWNzLCBmdW5jdGlvbiAoaW5kZXgsIHRvcGljKSB7XG4gICAgICAgICAgICAgICAgdG9waWMgPSBtYWtlTmFtZShvcHRzLmJhc2UsIG9wdHMudG9waWNSZXNvbHZlcih0b3BpYykpO1xuICAgICAgICAgICAgICAgIGlmICh0b3BpYy5jaGFyQXQodG9waWMubGVuZ3RoIC0gMSkgPT09ICcqJykge1xuICAgICAgICAgICAgICAgICAgICB0b3BpYyA9IHRvcGljLnJlcGxhY2UoL1xcKiskLywgJycpO1xuICAgICAgICAgICAgICAgICAgICBjb25zb2xlLndhcm4oJ1lvdSBjYW4gY2Fubm90IHB1Ymxpc2ggdG8gY2hhbm5lbHMgd2l0aCB3aWxkY2FyZHMuIFB1Ymxpc2hpbmcgdG8gJywgdG9waWMsICdpbnN0ZWFkJyk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIHJldHVybk9ianMucHVzaChvcHRzLnRyYW5zcG9ydC5wdWJsaXNoKHRvcGljLCBkYXRhKSk7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfSk7XG4gICAgICAgIHJldHVybiAocmV0dXJuT2Jqc1sxXSA/IHJldHVybk9ianMgOiByZXR1cm5PYmpzWzBdKTtcbiAgICB9LFxuXG4gICAgLyoqXG4gICAgICogVW5zdWJzY3JpYmUgZnJvbSBjaGFuZ2VzIHRvIGEgdG9waWMuXG4gICAgICpcbiAgICAgKiAqKkV4YW1wbGUqKlxuICAgICAqXG4gICAgICogICAgICBjcy51bnN1YnNjcmliZSgnc2FtcGxlVG9rZW4nKTtcbiAgICAgKlxuICAgICAqICoqUGFyYW1ldGVycyoqXG4gICAgICogQHBhcmFtICB7U3RyaW5nfSBgdG9rZW5gIFRoZSB0b2tlbiBmb3IgdG9waWMgaXMgcmV0dXJuZWQgd2hlbiB5b3UgaW5pdGlhbGx5IHN1YnNjcmliZS4gUGFzcyBpdCBoZXJlIHRvIHVuc3Vic2NyaWJlIGZyb20gdGhhdCB0b3BpYy5cbiAgICAgKi9cbiAgICB1bnN1YnNjcmliZTogZnVuY3Rpb24gKHRva2VuKSB7XG4gICAgICAgIHRoaXMuY2hhbm5lbE9wdGlvbnMudHJhbnNwb3J0LnVuc3Vic2NyaWJlKHRva2VuKTtcbiAgICAgICAgcmV0dXJuIHRva2VuO1xuICAgIH1cblxufSk7XG5cbm1vZHVsZS5leHBvcnRzID0gQ2hhbm5lbDtcbiIsIi8qKlxuICogQGNsYXNzIENvbmZpZ3VyYXRpb25TZXJ2aWNlXG4gKlxuICogQWxsIHNlcnZpY2VzIHRha2UgaW4gYSBjb25maWd1cmF0aW9uIHNldHRpbmdzIG9iamVjdCB0byBjb25maWd1cmUgdGhlbXNlbHZlcy4gQSBKUyBoYXNoIHt9IGlzIGEgdmFsaWQgY29uZmlndXJhdGlvbiBvYmplY3QsIGJ1dCBvcHRpb25hbGx5IHlvdSBjYW4gdXNlIHRoZSBjb25maWd1cmF0aW9uIHNlcnZpY2UgdG8gdG9nZ2xlIGNvbmZpZ3MgYmFzZWQgb24gdGhlIGVudmlyb25tZW50XG4gKlxuICogQGV4YW1wbGVcbiAqICAgICB2YXIgY3MgPSByZXF1aXJlKCdjb25maWd1cmF0aW9uLXNlcnZpY2UnKSh7XG4gKiAgICAgICAgICBkZXY6IHsgLy9lbnZpcm9ubWVudFxuICAgICAgICAgICAgICAgIHBvcnQ6IDMwMDAsXG4gICAgICAgICAgICAgICAgaG9zdDogJ2xvY2FsaG9zdCcsXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgcHJvZDoge1xuICAgICAgICAgICAgICAgIHBvcnQ6IDgwODAsXG4gICAgICAgICAgICAgICAgaG9zdDogJ2FwaS5mb3Jpby5jb20nLFxuICAgICAgICAgICAgICAgIGxvZ0xldmVsOiAnbm9uZSdcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgICBsb2dMZXZlbDogJ0RFQlVHJyAvL2dsb2JhbFxuICogICAgIH0pO1xuICpcbiAqICAgICAgY3MuZ2V0KCdsb2dMZXZlbCcpOyAvL3JldHVybnMgJ0RFQlVHJ1xuICpcbiAqICAgICAgY3Muc2V0RW52KCdkZXYnKTtcbiAqICAgICAgY3MuZ2V0KCdsb2dMZXZlbCcpOyAvL3JldHVybnMgJ0RFQlVHJ1xuICpcbiAqICAgICAgY3Muc2V0RW52KCdwcm9kJyk7XG4gKiAgICAgIGNzLmdldCgnbG9nTGV2ZWwnKTsgLy9yZXR1cm5zICdub25lJ1xuICpcbiAqL1xuXG4ndXNlIHN0cmljdCc7XG52YXIgdXJsU2VydmljZSA9IHJlcXVpcmUoJy4vdXJsLWNvbmZpZy1zZXJ2aWNlJyk7XG5cbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24gKGNvbmZpZykge1xuICAgIC8vVE9ETzogRW52aXJvbm1lbnRzXG4gICAgdmFyIGRlZmF1bHRzID0ge1xuICAgICAgICBsb2dMZXZlbDogJ05PTkUnXG4gICAgfTtcbiAgICB2YXIgc2VydmljZU9wdGlvbnMgPSAkLmV4dGVuZCh7fSwgZGVmYXVsdHMsIGNvbmZpZyk7XG4gICAgc2VydmljZU9wdGlvbnMuc2VydmVyID0gdXJsU2VydmljZShzZXJ2aWNlT3B0aW9ucy5zZXJ2ZXIpO1xuXG4gICAgcmV0dXJuIHtcblxuICAgICAgICBkYXRhOiBzZXJ2aWNlT3B0aW9ucyxcblxuICAgICAgICAvKipcbiAgICAgICAgICogU2V0IHRoZSBlbnZpcm9ubWVudCBrZXkgdG8gZ2V0IGNvbmZpZ3VyYXRpb24gb3B0aW9ucyBmcm9tXG4gICAgICAgICAqIEBwYXJhbSB7IHN0cmluZ30gZW52XG4gICAgICAgICAqL1xuICAgICAgICBzZXRFbnY6IGZ1bmN0aW9uIChlbnYpIHtcblxuICAgICAgICB9LFxuXG4gICAgICAgIC8qKlxuICAgICAgICAgKiBHZXQgY29uZmlndXJhdGlvbi5cbiAgICAgICAgICogQHBhcmFtICB7IHN0cmluZ30gcHJvcGVydHkgb3B0aW9uYWxcbiAgICAgICAgICogQHJldHVybiB7Kn0gICAgICAgICAgVmFsdWUgb2YgcHJvcGVydHkgaWYgc3BlY2lmaWVkLCB0aGUgZW50aXJlIGNvbmZpZyBvYmplY3Qgb3RoZXJ3aXNlXG4gICAgICAgICAqL1xuICAgICAgICBnZXQ6IGZ1bmN0aW9uIChwcm9wZXJ0eSkge1xuICAgICAgICAgICAgcmV0dXJuIHNlcnZpY2VPcHRpb25zW3Byb3BlcnR5XTtcbiAgICAgICAgfSxcblxuICAgICAgICAvKipcbiAgICAgICAgICogU2V0IGNvbmZpZ3VyYXRpb24uXG4gICAgICAgICAqIEBwYXJhbSAgeyBzdHJpbmd8T2JqZWN0fSBrZXkgaWYgYSBrZXkgaXMgcHJvdmlkZWQsIHNldCBhIGtleSB0byB0aGF0IHZhbHVlLiBPdGhlcndpc2UgbWVyZ2Ugb2JqZWN0IHdpdGggY3VycmVudCBjb25maWdcbiAgICAgICAgICogQHBhcmFtICB7Kn0gdmFsdWUgIHZhbHVlIGZvciBwcm92aWRlZCBrZXlcbiAgICAgICAgICovXG4gICAgICAgIHNldDogZnVuY3Rpb24gKGtleSwgdmFsdWUpIHtcbiAgICAgICAgICAgIHNlcnZpY2VPcHRpb25zW2tleV0gPSB2YWx1ZTtcbiAgICAgICAgfVxuICAgIH07XG59O1xuXG4iLCIvKipcbiAqICMjRGF0YSBBUEkgU2VydmljZVxuICpcbiAqIFRoZSBEYXRhIEFQSSBTZXJ2aWNlIGFsbG93cyB5b3UgdG8gY3JlYXRlLCBhY2Nlc3MsIGFuZCBtYW5pcHVsYXRlIGRhdGEgcmVsYXRlZCB0byBhbnkgb2YgeW91ciBwcm9qZWN0cy4gRGF0YSBhcmUgb3JnYW5pemVkIGluIGNvbGxlY3Rpb25zLiBFYWNoIGNvbGxlY3Rpb24gY29udGFpbnMgYSBkb2N1bWVudDsgZWFjaCBlbGVtZW50IG9mIHRoaXMgdG9wLWxldmVsIGRvY3VtZW50IGlzIGEgSlNPTiBvYmplY3QuIChTZWUgYWRkaXRpb25hbCBpbmZvcm1hdGlvbiBvbiB0aGUgdW5kZXJseWluZyBbRGF0YSBBUEldKC4uLy4uLy4uL3Jlc3RfYXBpcy9kYXRhX2FwaS8pLilcbiAqXG4gKiBBbGwgQVBJIGNhbGxzIHRha2UgaW4gYW4gXCJvcHRpb25zXCIgb2JqZWN0IGFzIHRoZSBsYXN0IHBhcmFtZXRlci4gVGhlIG9wdGlvbnMgY2FuIGJlIHVzZWQgdG8gZXh0ZW5kL292ZXJyaWRlIHRoZSBEYXRhIEFQSSBTZXJ2aWNlIGRlZmF1bHRzLiBJbiBwYXJ0aWN1bGFyLCB0aGUgYHJvb3RgIG9wdGlvbiBjb250YWlucyB0aGUgbmFtZSBvZiB0aGUgY29sbGVjdGlvbi4gSWYgeW91IGhhdmUgbXVsdGlwbGUgY29sbGVjdGlvbnMgd2l0aGluIGVhY2ggb2YgeW91ciBwcm9qZWN0cywgeW91IGNhbiBwYXNzIHRoZSBjb2xsZWN0aW9uIG5hbWUgYXMgYW4gb3B0aW9uIGZvciBlYWNoIGNhbGwuXG4gKlxuICogICAgICB2YXIgZHMgPSBuZXcgRi5zZXJ2aWNlLkRhdGEoeyByb290OiAnc3VydmV5LXJlc3BvbnNlcycgfSk7XG4gKiAgICAgIGRzLnNhdmVBcygndXNlcjEnLFxuICogICAgICAgICAgeyAncXVlc3Rpb24xJzogMiwgJ3F1ZXN0aW9uMic6IDEwLFxuICogICAgICAgICAgICdxdWVzdGlvbjMnOiBmYWxzZSwgJ3F1ZXN0aW9uNCc6ICdzb21ldGltZXMnIH0gKTtcbiAqICAgICAgZHMuc2F2ZUFzKCd1c2VyMicsXG4gKiAgICAgICAgICB7ICdxdWVzdGlvbjEnOiAzLCAncXVlc3Rpb24yJzogOCxcbiAqICAgICAgICAgICAncXVlc3Rpb24zJzogdHJ1ZSwgJ3F1ZXN0aW9uNCc6ICdhbHdheXMnIH0gKTtcbiAqICAgICAgZHMucXVlcnkoJycseyAncXVlc3Rpb24yJzogeyAnJGd0JzogOX0gfSk7XG4gKlxuICovXG5cbid1c2Ugc3RyaWN0JztcblxudmFyIENvbmZpZ1NlcnZpY2UgPSByZXF1aXJlKCcuL2NvbmZpZ3VyYXRpb24tc2VydmljZScpO1xudmFyIFN0b3JhZ2VGYWN0b3J5ID0gcmVxdWlyZSgnLi4vc3RvcmUvc3RvcmUtZmFjdG9yeScpO1xudmFyIHF1dGlsID0gcmVxdWlyZSgnLi4vdXRpbC9xdWVyeS11dGlsJyk7XG52YXIgVHJhbnNwb3J0RmFjdG9yeSA9IHJlcXVpcmUoJy4uL3RyYW5zcG9ydC9odHRwLXRyYW5zcG9ydC1mYWN0b3J5Jyk7XG5cbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24gKGNvbmZpZykge1xuICAgIHZhciBzdG9yZSA9IG5ldyBTdG9yYWdlRmFjdG9yeSh7IHN5bmNocm9ub3VzOiB0cnVlIH0pO1xuXG4gICAgdmFyIGRlZmF1bHRzID0ge1xuICAgICAgICAvKipcbiAgICAgICAgICogTmFtZSBvZiBjb2xsZWN0aW9uLiBEZWZhdWx0cyB0byBgL2AsIHRoYXQgaXMsIHRoZSByb290IGxldmVsIG9mIHlvdXIgcHJvamVjdCBhdCBgZm9yaW8uY29tL2FwcC95b3VyLWFjY291bnQtaWQveW91ci1wcm9qZWN0LWlkL2AuIFJlcXVpcmVkLlxuICAgICAgICAgKiBAdHlwZSB7U3RyaW5nfVxuICAgICAgICAgKi9cbiAgICAgICAgcm9vdDogJy8nLFxuXG4gICAgICAgIC8qKlxuICAgICAgICAgKiBGb3Igb3BlcmF0aW9ucyB0aGF0IHJlcXVpcmUgYXV0aGVudGljYXRpb24sIHBhc3MgaW4gdGhlIHVzZXIgYWNjZXNzIHRva2VuIChkZWZhdWx0cyB0byBlbXB0eSBzdHJpbmcpLiBJZiB0aGUgdXNlciBpcyBhbHJlYWR5IGxvZ2dlZCBpbiB0byBFcGljZW50ZXIsIHRoZSB1c2VyIGFjY2VzcyB0b2tlbiBpcyBhbHJlYWR5IHNldCBpbiBhIGNvb2tpZSBhbmQgYXV0b21hdGljYWxseSBsb2FkZWQgZnJvbSB0aGVyZS4gKFNlZSBbbW9yZSBiYWNrZ3JvdW5kIG9uIGFjY2VzcyB0b2tlbnNdKC4uLy4uLy4uL3Byb2plY3RfYWNjZXNzLykpLlxuICAgICAgICAgKiBAc2VlIFtBdXRoZW50aWNhdGlvbiBBUEkgU2VydmljZV0oLi4vYXV0aC1hcGktc2VydmljZS8pIGZvciBnZXR0aW5nIHRva2Vucy5cbiAgICAgICAgICogQHR5cGUge1N0cmluZ31cbiAgICAgICAgICovXG4gICAgICAgIHRva2VuOiBzdG9yZS5nZXQoJ2VwaWNlbnRlci5wcm9qZWN0LnRva2VuJykgfHwgJycsXG5cbiAgICAgICAgYXBpS2V5OiAnJyxcbiAgICAgICAgZG9tYWluOiAnZm9yaW8uY29tJyxcblxuICAgICAgICAvL09wdGlvbnMgdG8gcGFzcyBvbiB0byB0aGUgdW5kZXJseWluZyB0cmFuc3BvcnQgbGF5ZXJcbiAgICAgICAgdHJhbnNwb3J0OiB7fVxuICAgIH07XG4gICAgdmFyIHNlcnZpY2VPcHRpb25zID0gJC5leHRlbmQoe30sIGRlZmF1bHRzLCBjb25maWcpO1xuXG4gICAgdmFyIHVybENvbmZpZyA9IG5ldyBDb25maWdTZXJ2aWNlKHNlcnZpY2VPcHRpb25zKS5nZXQoJ3NlcnZlcicpO1xuICAgIGlmIChzZXJ2aWNlT3B0aW9ucy5hY2NvdW50KSB7XG4gICAgICAgIHVybENvbmZpZy5hY2NvdW50UGF0aCA9IHNlcnZpY2VPcHRpb25zLmFjY291bnQ7XG4gICAgfVxuICAgIGlmIChzZXJ2aWNlT3B0aW9ucy5wcm9qZWN0KSB7XG4gICAgICAgIHVybENvbmZpZy5wcm9qZWN0UGF0aCA9IHNlcnZpY2VPcHRpb25zLnByb2plY3Q7XG4gICAgfVxuXG4gICAgdmFyIGdldFVSTCA9IGZ1bmN0aW9uIChrZXksIHJvb3QpIHtcbiAgICAgICAgaWYgKCFyb290KSB7XG4gICAgICAgICAgICByb290ID0gc2VydmljZU9wdGlvbnMucm9vdDtcbiAgICAgICAgfVxuICAgICAgICB2YXIgdXJsID0gdXJsQ29uZmlnLmdldEFQSVBhdGgoJ2RhdGEnKSArIHF1dGlsLmFkZFRyYWlsaW5nU2xhc2gocm9vdCk7XG4gICAgICAgIGlmIChrZXkpIHtcbiAgICAgICAgICAgIHVybCs9IHF1dGlsLmFkZFRyYWlsaW5nU2xhc2goa2V5KTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gdXJsO1xuICAgIH07XG5cbiAgICB2YXIgaHR0cE9wdGlvbnMgPSAkLmV4dGVuZCh0cnVlLCB7fSwgc2VydmljZU9wdGlvbnMudHJhbnNwb3J0LCB7XG4gICAgICAgIHVybDogZ2V0VVJMXG4gICAgfSk7XG4gICAgaWYgKHNlcnZpY2VPcHRpb25zLnRva2VuKSB7XG4gICAgICAgIGh0dHBPcHRpb25zLmhlYWRlcnMgPSB7XG4gICAgICAgICAgICAnQXV0aG9yaXphdGlvbic6ICdCZWFyZXIgJyArIHNlcnZpY2VPcHRpb25zLnRva2VuXG4gICAgICAgIH07XG4gICAgfVxuICAgIHZhciBodHRwID0gbmV3IFRyYW5zcG9ydEZhY3RvcnkoaHR0cE9wdGlvbnMpO1xuXG4gICAgdmFyIHB1YmxpY0FQSSA9IHtcblxuICAgICAgICAvKipcbiAgICAgICAgICogU2VhcmNoIGZvciBkYXRhIHdpdGhpbiBhIGNvbGxlY3Rpb24uXG4gICAgICAgICAqXG4gICAgICAgICAqIFNlYXJjaGluZyB1c2luZyBjb21wYXJpc29uIG9yIGxvZ2ljYWwgb3BlcmF0b3JzIChhcyBvcHBvc2VkIHRvIGV4YWN0IG1hdGNoZXMpIHJlcXVpcmVzIE1vbmdvREIgc3ludGF4LiBTZWUgdGhlIHVuZGVybHlpbmcgW0RhdGEgQVBJXSguLi8uLi8uLi9yZXN0X2FwaXMvZGF0YV9hcGkvI3NlYXJjaGluZykgZm9yIGFkZGl0aW9uYWwgZGV0YWlscy5cbiAgICAgICAgICpcbiAgICAgICAgICogKipFeGFtcGxlcyoqXG4gICAgICAgICAqXG4gICAgICAgICAqICAgICAgLy8gcmVxdWVzdCBhbGwgZGF0YSBhc3NvY2lhdGVkIHdpdGggZG9jdW1lbnQgJ3VzZXIxJ1xuICAgICAgICAgKiAgICAgIGRzLnF1ZXJ5KCd1c2VyMScpO1xuICAgICAgICAgKlxuICAgICAgICAgKiAgICAgIC8vIGV4YWN0IG1hdGNoaW5nOlxuICAgICAgICAgKiAgICAgIC8vIHJlcXVlc3QgYWxsIGRvY3VtZW50cyBpbiBjb2xsZWN0aW9uIHdoZXJlICdxdWVzdGlvbjInIGlzIDlcbiAgICAgICAgICogICAgICBkcy5xdWVyeSgnJywgeyAncXVlc3Rpb24yJzogOX0pO1xuICAgICAgICAgKlxuICAgICAgICAgKiAgICAgIC8vIGNvbXBhcmlzb24gb3BlcmF0b3JzOlxuICAgICAgICAgKiAgICAgIC8vIHJlcXVlc3QgYWxsIGRvY3VtZW50cyBpbiBjb2xsZWN0aW9uXG4gICAgICAgICAqICAgICAgLy8gd2hlcmUgJ3F1ZXN0aW9uMicgaXMgZ3JlYXRlciB0aGFuIDlcbiAgICAgICAgICogICAgICBkcy5xdWVyeSgnJywgeyAncXVlc3Rpb24yJzogeyAnJGd0JzogOX0gfSk7XG4gICAgICAgICAqXG4gICAgICAgICAqICAgICAgLy8gbG9naWNhbCBvcGVyYXRvcnM6XG4gICAgICAgICAqICAgICAgLy8gcmVxdWVzdCBhbGwgZG9jdW1lbnRzIGluIGNvbGxlY3Rpb25cbiAgICAgICAgICogICAgICAvLyB3aGVyZSAncXVlc3Rpb24yJyBpcyBsZXNzIHRoYW4gMTAsIGFuZCAncXVlc3Rpb24zJyBpcyBmYWxzZVxuICAgICAgICAgKiAgICAgIGRzLnF1ZXJ5KCcnLCB7ICckYW5kJzogWyB7ICdxdWVzdGlvbjInOiB7ICckbHQnOjEwfSB9LCB7ICdxdWVzdGlvbjMnOiBmYWxzZSB9XSB9KTtcbiAgICAgICAgICpcbiAgICAgICAgICogICAgICAvLyByZWd1bGFyIGV4cHJlc3NzaW9uczogdXNlIGFueSBQZXJsLWNvbXBhdGlibGUgcmVndWxhciBleHByZXNzaW9uc1xuICAgICAgICAgKiAgICAgIC8vIHJlcXVlc3QgYWxsIGRvY3VtZW50cyBpbiBjb2xsZWN0aW9uXG4gICAgICAgICAqICAgICAgLy8gd2hlcmUgJ3F1ZXN0aW9uNScgY29udGFpbnMgdGhlIHN0cmluZyAnKmRheSdcbiAgICAgICAgICogICAgICBkcy5xdWVyeSgnJywgeyAncXVlc3Rpb241JzogeyAnJHJlZ2V4JzogJypkYXknIH0gfSk7XG4gICAgICAgICAqXG4gICAgICAgICAqICoqUGFyYW1ldGVycyoqXG4gICAgICAgICAqIEBwYXJhbSB7U3RyaW5nfSBga2V5YCBUaGUgbmFtZSBvZiB0aGUgZG9jdW1lbnQgdG8gc2VhcmNoLiBQYXNzIHRoZSBlbXB0eSBzdHJpbmcgKCcnKSB0byBzZWFyY2ggdGhlIGVudGlyZSBjb2xsZWN0aW9uLlxuICAgICAgICAgKiBAcGFyYW0ge09iamVjdH0gYHF1ZXJ5YCBUaGUgcXVlcnkgb2JqZWN0LiBGb3IgZXhhY3QgbWF0Y2hpbmcsIHRoaXMgb2JqZWN0IGNvbnRhaW5zIHRoZSBmaWVsZCBuYW1lIGFuZCBmaWVsZCB2YWx1ZSB0byBtYXRjaC4gRm9yIG1hdGNoaW5nIGJhc2VkIG9uIGNvbXBhcmlzb24sIHRoaXMgb2JqZWN0IGNvbnRhaW5zIHRoZSBmaWVsZCBuYW1lIGFuZCB0aGUgY29tcGFyaXNvbiBleHByZXNzaW9uLiBGb3IgbWF0Y2hpbmcgYmFzZWQgb24gbG9naWNhbCBvcGVyYXRvcnMsIHRoaXMgb2JqZWN0IGNvbnRhaW5zIGFuIGV4cHJlc3Npb24gdXNpbmcgTW9uZ29EQiBzeW50YXguIFNlZSB0aGUgdW5kZXJseWluZyBbRGF0YSBBUEldKC4uLy4uLy4uL3Jlc3RfYXBpcy9kYXRhX2FwaS8jc2VhcmNoaW5nKSBmb3IgYWRkaXRpb25hbCBleGFtcGxlcy5cbiAgICAgICAgICogQHBhcmFtIHtPYmplY3R9IGBvdXRwdXRNb2RpZmllcmAgKE9wdGlvbmFsKSBBdmFpbGFibGUgZmllbGRzIGluY2x1ZGU6IGBzdGFydHJlY29yZGAsIGBlbmRyZWNvcmRgLCBgc29ydGAsIGFuZCBgZGlyZWN0aW9uYCAoYGFzY2Agb3IgYGRlc2NgKS5cbiAgICAgICAgICogQHBhcmFtIHtPYmplY3R9IGBvcHRpb25zYCAoT3B0aW9uYWwpIE92ZXJyaWRlcyBmb3IgY29uZmlndXJhdGlvbiBvcHRpb25zLlxuICAgICAgICAgKlxuICAgICAgICAgKi9cbiAgICAgICAgcXVlcnk6IGZ1bmN0aW9uIChrZXksIHF1ZXJ5LCBvdXRwdXRNb2RpZmllciwgb3B0aW9ucykge1xuICAgICAgICAgICAgdmFyIHBhcmFtcyA9ICQuZXh0ZW5kKHRydWUsIHsgcTogcXVlcnkgfSwgb3V0cHV0TW9kaWZpZXIpO1xuICAgICAgICAgICAgdmFyIGh0dHBPcHRpb25zID0gJC5leHRlbmQodHJ1ZSwge30sIHNlcnZpY2VPcHRpb25zLCBvcHRpb25zKTtcbiAgICAgICAgICAgIGh0dHBPcHRpb25zLnVybCA9IGdldFVSTChrZXksIGh0dHBPcHRpb25zLnJvb3QpO1xuICAgICAgICAgICAgcmV0dXJuIGh0dHAuZ2V0KHBhcmFtcywgaHR0cE9wdGlvbnMpO1xuICAgICAgICB9LFxuXG4gICAgICAgIC8qKlxuICAgICAgICAgKiBTYXZlIGRhdGEgdG8gYW4gYW5vbnltb3VzIGRvY3VtZW50IHdpdGhpbiB0aGUgY29sbGVjdGlvbi5cbiAgICAgICAgICpcbiAgICAgICAgICogKERvY3VtZW50cyBhcmUgdG9wLWxldmVsIGVsZW1lbnRzIHdpdGhpbiBhIGNvbGxlY3Rpb24uIENvbGxlY3Rpb25zIG11c3QgYmUgdW5pcXVlIHdpdGhpbiB0aGlzIGFjY291bnQgKHRlYW0gb3IgcGVyc29uYWwgYWNjb3VudCkgYW5kIHByb2plY3QgYW5kIGFyZSBzZXQgd2l0aCB0aGUgYHJvb3RgIGZpZWxkIGluIHRoZSBgb3B0aW9uYCBwYXJhbWV0ZXIuIFNlZSB0aGUgdW5kZXJseWluZyBbRGF0YSBBUEldKC4uLy4uLy4uL3Jlc3RfYXBpcy9kYXRhX2FwaS8pIGZvciBhZGRpdGlvbmFsIGJhY2tncm91bmQuKVxuICAgICAgICAgKlxuICAgICAgICAgKiAqKkV4YW1wbGUqKlxuICAgICAgICAgKlxuICAgICAgICAgKiAgICAgIGRzLnNhdmUoJ3F1ZXN0aW9uMScsICd5ZXMnKTtcbiAgICAgICAgICogICAgICBkcy5zYXZlKHtxdWVzdGlvbjE6J3llcycsIHF1ZXN0aW9uMjogMzIgfSk7XG4gICAgICAgICAqICAgICAgZHMuc2F2ZSh7IG5hbWU6J0pvaG4nLCBjbGFzc05hbWU6ICdDUzEwMScgfSwgeyByb290OiAnc3R1ZGVudHMnIH0pO1xuICAgICAgICAgKlxuICAgICAgICAgKiAqKlBhcmFtZXRlcnMqKlxuICAgICAgICAgKlxuICAgICAgICAgKiBAcGFyYW0ge1N0cmluZ3xPYmplY3R9IGBrZXlgIElmIGBrZXlgIGlzIGEgc3RyaW5nLCBpdCBpcyB0aGUgaWQgb2YgdGhlIGVsZW1lbnQgdG8gc2F2ZSAoY3JlYXRlKSBpbiB0aGlzIGRvY3VtZW50LiBJZiBga2V5YCBpcyBhbiBvYmplY3QsIHRoZSBvYmplY3QgaXMgdGhlIGRhdGEgdG8gc2F2ZSAoY3JlYXRlKSBpbiB0aGlzIGRvY3VtZW50LiBJbiBib3RoIGNhc2VzLCB0aGUgaWQgZm9yIHRoZSBkb2N1bWVudCBpcyBnZW5lcmF0ZWQgYXV0b21hdGljYWxseS5cbiAgICAgICAgICogQHBhcmFtIHtPYmplY3R9IGB2YWx1ZWAgKE9wdGlvbmFsKSBUaGUgZGF0YSB0byBzYXZlLiBJZiBga2V5YCBpcyBhIHN0cmluZywgdGhpcyBpcyB0aGUgdmFsdWUgdG8gc2F2ZS4gSWYgYGtleWAgaXMgYW4gb2JqZWN0LCB0aGUgdmFsdWUocykgdG8gc2F2ZSBhcmUgYWxyZWFkeSBwYXJ0IG9mIGBrZXlgIGFuZCB0aGlzIGFyZ3VtZW50IGlzIG5vdCByZXF1aXJlZC5cbiAgICAgICAgICogQHBhcmFtIHtPYmplY3R9IGBvcHRpb25zYCAoT3B0aW9uYWwpIE92ZXJyaWRlcyBmb3IgY29uZmlndXJhdGlvbiBvcHRpb25zLlxuICAgICAgICAgKi9cbiAgICAgICAgc2F2ZTogZnVuY3Rpb24gKGtleSwgdmFsdWUsIG9wdGlvbnMpIHtcbiAgICAgICAgICAgIHZhciBhdHRycztcbiAgICAgICAgICAgIGlmICh0eXBlb2Yga2V5ID09PSAnb2JqZWN0Jykge1xuICAgICAgICAgICAgICAgIGF0dHJzID0ga2V5O1xuICAgICAgICAgICAgICAgIG9wdGlvbnMgPSB2YWx1ZTtcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgKGF0dHJzID0ge30pW2tleV0gPSB2YWx1ZTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHZhciBodHRwT3B0aW9ucyA9ICQuZXh0ZW5kKHRydWUsIHt9LCBzZXJ2aWNlT3B0aW9ucywgb3B0aW9ucyk7XG4gICAgICAgICAgICBodHRwT3B0aW9ucy51cmwgPSBnZXRVUkwoJycsIGh0dHBPcHRpb25zLnJvb3QpO1xuXG4gICAgICAgICAgICByZXR1cm4gaHR0cC5wb3N0KGF0dHJzLCBodHRwT3B0aW9ucyk7XG4gICAgICAgIH0sXG5cbiAgICAgICAgLyoqXG4gICAgICAgICAqIFNhdmUgZGF0YSB0byBhIG5hbWVkIGRvY3VtZW50IG9yIGVsZW1lbnQgd2l0aGluIHRoZSBjb2xsZWN0aW9uLiBUaGUgYHJvb3RgIG9mIHRoZSBjb2xsZWN0aW9uIG11c3QgYmUgc3BlY2lmaWVkIHNlcGFyYXRlbHkgaW4gY29uZmlndXJhdGlvbiBvcHRpb25zLCBlaXRoZXIgYXMgcGFydCBvZiB0aGUgY2FsbCBvciBhcyBwYXJ0IG9mIHRoZSBpbml0aWFsaXphdGlvbiBvZiBkcy5cbiAgICAgICAgICpcbiAgICAgICAgICogKERvY3VtZW50cyBhcmUgdG9wLWxldmVsIGVsZW1lbnRzIHdpdGhpbiBhIGNvbGxlY3Rpb24uIENvbGxlY3Rpb25zIG11c3QgYmUgdW5pcXVlIHdpdGhpbiB0aGlzIGFjY291bnQgKHRlYW0gb3IgcGVyc29uYWwgYWNjb3VudCkgYW5kIHByb2plY3QgYW5kIGFyZSBzZXQgd2l0aCB0aGUgYHJvb3RgIGZpZWxkIGluIHRoZSBgb3B0aW9uYCBwYXJhbWV0ZXIuIFNlZSB0aGUgdW5kZXJseWluZyBbRGF0YSBBUEldKC4uLy4uLy4uL3Jlc3RfYXBpcy9kYXRhX2FwaS8pIGZvciBhZGRpdGlvbmFsIGJhY2tncm91bmQuKVxuICAgICAgICAgKlxuICAgICAgICAgKiAqKkV4YW1wbGUqKlxuICAgICAgICAgKlxuICAgICAgICAgKiAgICAgIGRzLnNhdmVBcygndXNlcjEnLFxuICAgICAgICAgKiAgICAgICAgICB7ICdxdWVzdGlvbjEnOiAyLCAncXVlc3Rpb24yJzogMTAsXG4gICAgICAgICAqICAgICAgICAgICAncXVlc3Rpb24zJzogZmFsc2UsICdxdWVzdGlvbjQnOiAnc29tZXRpbWVzJyB9ICk7XG4gICAgICAgICAqICAgICAgZHMuc2F2ZUFzKCdzdHVkZW50MScsXG4gICAgICAgICAqICAgICAgICAgIHsgZmlyc3ROYW1lOiAnam9obicsIGxhc3ROYW1lOiAnc21pdGgnIH0sXG4gICAgICAgICAqICAgICAgICAgIHsgcm9vdDogJ3N0dWRlbnRzJyB9KTtcbiAgICAgICAgICogICAgICBkcy5zYXZlQXMoJ21nbXQxMDAvZ3JvdXBCJyxcbiAgICAgICAgICogICAgICAgICAgeyBzY2VuYXJpb1llYXI6ICcyMDE1JyB9LFxuICAgICAgICAgKiAgICAgICAgICB7IHJvb3Q6ICdteWNsYXNzZXMnIH0pO1xuICAgICAgICAgKlxuICAgICAgICAgKiAqKlBhcmFtZXRlcnMqKlxuICAgICAgICAgKlxuICAgICAgICAgKiBAcGFyYW0ge1N0cmluZ30gYGtleWAgSWQgb2YgdGhlIGRvY3VtZW50LlxuICAgICAgICAgKiBAcGFyYW0ge09iamVjdH0gYHZhbHVlYCAoT3B0aW9uYWwpIFRoZSBkYXRhIHRvIHNhdmUsIGluIGtleTp2YWx1ZSBwYWlycy5cbiAgICAgICAgICogQHBhcmFtIHtPYmplY3R9IGBvcHRpb25zYCAoT3B0aW9uYWwpIE92ZXJyaWRlcyBmb3IgY29uZmlndXJhdGlvbiBvcHRpb25zLlxuICAgICAgICAgKi9cbiAgICAgICAgc2F2ZUFzOiBmdW5jdGlvbiAoa2V5LCB2YWx1ZSwgb3B0aW9ucykge1xuICAgICAgICAgICAgdmFyIGh0dHBPcHRpb25zID0gJC5leHRlbmQodHJ1ZSwge30sIHNlcnZpY2VPcHRpb25zLCBvcHRpb25zKTtcbiAgICAgICAgICAgIGh0dHBPcHRpb25zLnVybCA9IGdldFVSTChrZXksIGh0dHBPcHRpb25zLnJvb3QpO1xuXG4gICAgICAgICAgICByZXR1cm4gaHR0cC5wdXQodmFsdWUsIGh0dHBPcHRpb25zKTtcbiAgICAgICAgfSxcblxuICAgICAgICAvKipcbiAgICAgICAgICogR2V0IGRhdGEgZm9yIGEgc3BlY2lmaWMgZG9jdW1lbnQgb3IgZmllbGQuXG4gICAgICAgICAqXG4gICAgICAgICAqICoqRXhhbXBsZSoqXG4gICAgICAgICAqXG4gICAgICAgICAqICAgICAgZHMubG9hZCgndXNlcjEnKTtcbiAgICAgICAgICogICAgICBkcy5sb2FkKCd1c2VyMS9xdWVzdGlvbjMnKTtcbiAgICAgICAgICpcbiAgICAgICAgICogKipQYXJhbWV0ZXJzKipcbiAgICAgICAgICogQHBhcmFtICB7U3RyaW5nfE9iamVjdH0gYGtleWAgVGhlIGlkIG9mIHRoZSBkYXRhIHRvIHJldHVybi4gQ2FuIGJlIHRoZSBpZCBvZiBhIGRvY3VtZW50LCBvciBhIHBhdGggdG8gZGF0YSB3aXRoaW4gdGhhdCBkb2N1bWVudC5cbiAgICAgICAgICogQHBhcmFtIHtPYmplY3R9IGBvdXRwdXRNb2RpZmllcmAgKE9wdGlvbmFsKSBBdmFpbGFibGUgZmllbGRzIGluY2x1ZGU6IGBzdGFydHJlY29yZGAsIGBlbmRyZWNvcmRgLCBgc29ydGAsIGFuZCBgZGlyZWN0aW9uYCAoYGFzY2Agb3IgYGRlc2NgKS5cbiAgICAgICAgICogQHBhcmFtIHtPYmplY3R9IGBvcHRpb25zYCBPdmVycmlkZXMgZm9yIGNvbmZpZ3VyYXRpb24gb3B0aW9ucy5cbiAgICAgICAgICovXG4gICAgICAgIGxvYWQ6IGZ1bmN0aW9uIChrZXksIG91dHB1dE1vZGlmaWVyLCBvcHRpb25zKSB7XG4gICAgICAgICAgICB2YXIgaHR0cE9wdGlvbnMgPSAkLmV4dGVuZCh0cnVlLCB7fSwgc2VydmljZU9wdGlvbnMsIG9wdGlvbnMpO1xuICAgICAgICAgICAgaHR0cE9wdGlvbnMudXJsID0gZ2V0VVJMKGtleSwgaHR0cE9wdGlvbnMucm9vdCk7XG4gICAgICAgICAgICByZXR1cm4gaHR0cC5nZXQob3V0cHV0TW9kaWZpZXIsIGh0dHBPcHRpb25zKTtcbiAgICAgICAgfSxcblxuICAgICAgICAvKipcbiAgICAgICAgICogUmVtb3ZlcyBkYXRhIGZyb20gY29sbGVjdGlvbi4gT25seSBkb2N1bWVudHMgKHRvcC1sZXZlbCBlbGVtZW50cyBpbiBlYWNoIGNvbGxlY3Rpb24pIGNhbiBiZSBkZWxldGVkLlxuICAgICAgICAgKlxuICAgICAgICAgKiAqKkV4YW1wbGUqKlxuICAgICAgICAgKlxuICAgICAgICAgKiAgICAgZHMucmVtb3ZlKCd1c2VyMScpO1xuICAgICAgICAgKlxuICAgICAgICAgKlxuICAgICAgICAgKiAqKlBhcmFtZXRlcnMqKlxuICAgICAgICAgKlxuICAgICAgICAgKiBAcGFyYW0ge1N0cmluZ30gYGtleWAgVGhlIGlkIG9mIHRoZSBkb2N1bWVudCB0byByZW1vdmUgZnJvbSB0aGlzIGNvbGxlY3Rpb24uXG4gICAgICAgICAqIEBwYXJhbSB7T2JqZWN0fSBgb3B0aW9uc2AgKE9wdGlvbmFsKSBPdmVycmlkZXMgZm9yIGNvbmZpZ3VyYXRpb24gb3B0aW9ucy5cbiAgICAgICAgICovXG4gICAgICAgIHJlbW92ZTogZnVuY3Rpb24gKGtleXMsIG9wdGlvbnMpIHtcbiAgICAgICAgICAgIHZhciBodHRwT3B0aW9ucyA9ICQuZXh0ZW5kKHRydWUsIHt9LCBzZXJ2aWNlT3B0aW9ucywgb3B0aW9ucyk7XG4gICAgICAgICAgICB2YXIgcGFyYW1zO1xuICAgICAgICAgICAgaWYgKCQuaXNBcnJheShrZXlzKSkge1xuICAgICAgICAgICAgICAgIHBhcmFtcyA9IHsgaWQ6IGtleXMgfTtcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgcGFyYW1zID0gJyc7XG4gICAgICAgICAgICAgICAgaHR0cE9wdGlvbnMudXJsID0gZ2V0VVJMKGtleXMsIGh0dHBPcHRpb25zLnJvb3QpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgcmV0dXJuIGh0dHAuZGVsZXRlKHBhcmFtcywgaHR0cE9wdGlvbnMpO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gRXBpY2VudGVyIGRvZXNuJ3QgYWxsb3cgbnVraW5nIGNvbGxlY3Rpb25zXG4gICAgICAgIC8vICAgICAvKipcbiAgICAgICAgLy8gICAgICAqIFJlbW92ZXMgY29sbGVjdGlvbiBiZWluZyByZWZlcmVuY2VkXG4gICAgICAgIC8vICAgICAgKiBAcmV0dXJuIG51bGxcbiAgICAgICAgLy8gICAgICAqL1xuICAgICAgICAvLyAgICAgZGVzdHJveTogZnVuY3Rpb24gKG9wdGlvbnMpIHtcbiAgICAgICAgLy8gICAgICAgICByZXR1cm4gdGhpcy5yZW1vdmUoJycsIG9wdGlvbnMpO1xuICAgICAgICAvLyAgICAgfVxuICAgIH07XG5cbiAgICAkLmV4dGVuZCh0aGlzLCBwdWJsaWNBUEkpO1xufTtcbiIsIi8qKlxuICpcbiAqICMjTWVtYmVyIEFQSSBBZGFwdGVyXG4gKlxuICogVGhlIE1lbWJlciBBUEkgQWRhcHRlciBwcm92aWRlcyBtZXRob2RzIHRvIGxvb2t1cCB1c2VyIGRldGFpbHMgb3IgZ3JvdXAgZGV0YWlsc1xuICpcbiAqICAgICAgdmFyIGF1dGggPSBuZXcgRi5hZGFwdGVyLk1lbWJlcigpO1xuICogICAgICBhdXRoLmdldEdyb3Vwc0J5VXNlcih7IHVzZXJJZDogJ2I2YjMxM2EzLWFiODQtNDc5Yy1iYWVhLTIwNmY2YmZmMzM3JyB9KTtcbiAqICAgICAgYXV0aC5nZXRHcm91cERldGFpbHMoeyBncm91cElkOiAnMDBiNTMzMDgtOTgzMy00N2YyLWIyMWUtMTI3OGMwN2Q1M2I4JyB9KTtcbiAqL1xuXG4ndXNlIHN0cmljdCc7XG5cbnZhciBDb25maWdTZXJ2aWNlID0gcmVxdWlyZSgnLi9jb25maWd1cmF0aW9uLXNlcnZpY2UnKTtcbnZhciBUcmFuc3BvcnRGYWN0b3J5ID0gcmVxdWlyZSgnLi4vdHJhbnNwb3J0L2h0dHAtdHJhbnNwb3J0LWZhY3RvcnknKTtcbnZhciBfcGljayA9IHJlcXVpcmUoJy4uL3V0aWwvb2JqZWN0LXV0aWwnKS5fcGljaztcbnZhciBhcGlFbmRwb2ludCA9ICdtZW1iZXIvbG9jYWwnO1xuXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uIChjb25maWcpIHtcbiAgICB2YXIgZGVmYXVsdHMgPSB7XG4gICAgICAgIC8qKlxuICAgICAgICAgKiBFcGljZW50ZXIgdXNlcklkLiBEZWZhdWx0cyB0byBhIGJsYW5rIHN0cmluZ1xuICAgICAgICAgKiBAdHlwZSB7IHN0cmluZ31cbiAgICAgICAgICovXG4gICAgICAgIHVzZXJJZDogJycsXG5cbiAgICAgICAgLyoqXG4gICAgICAgICAqIEVwaWNlbnRlciBncm91cElkLiBEZWZhdWx0cyB0byBhIGJsYW5rIHN0cmluZ1xuICAgICAgICAgKiBAdHlwZSB7IHN0cmluZ31cbiAgICAgICAgICovXG4gICAgICAgIGdyb3VwSWQ6ICcnLFxuXG4gICAgICAgIC8qKlxuICAgICAgICAgKiBPcHRpb25zIHRvIHBhc3Mgb24gdG8gdGhlIHVuZGVybHlpbmcgdHJhbnNwb3J0IGxheWVyLiBBbGwganF1ZXJ5LmFqYXggb3B0aW9ucyBhdCBodHRwOi8vYXBpLmpxdWVyeS5jb20valF1ZXJ5LmFqYXgvIGFyZSBhdmFpbGFibGUuIERlZmF1bHRzIHRvIGVtcHR5IG9iamVjdC5cbiAgICAgICAgICogQHR5cGUge29iamVjdH1cbiAgICAgICAgICovXG4gICAgICAgIHRyYW5zcG9ydDoge31cbiAgICB9O1xuICAgIHZhciBzZXJ2aWNlT3B0aW9ucyA9ICQuZXh0ZW5kKHt9LCBkZWZhdWx0cywgY29uZmlnKTtcbiAgICB2YXIgdXJsQ29uZmlnID0gbmV3IENvbmZpZ1NlcnZpY2Uoc2VydmljZU9wdGlvbnMpLmdldCgnc2VydmVyJyk7XG5cbiAgICB2YXIgdHJhbnNwb3J0T3B0aW9ucyA9ICQuZXh0ZW5kKHRydWUsIHt9LCBzZXJ2aWNlT3B0aW9ucy50cmFuc3BvcnQsIHtcbiAgICAgICAgdXJsOiB1cmxDb25maWcuZ2V0QVBJUGF0aChhcGlFbmRwb2ludClcbiAgICB9KTtcblxuICAgIGlmIChzZXJ2aWNlT3B0aW9ucy50b2tlbikge1xuICAgICAgICB0cmFuc3BvcnRPcHRpb25zLmhlYWRlcnMgPSB7XG4gICAgICAgICAgICAnQXV0aG9yaXphdGlvbic6ICdCZWFyZXIgJyArIHNlcnZpY2VPcHRpb25zLnRva2VuXG4gICAgICAgIH07XG4gICAgfVxuICAgIHZhciBodHRwID0gbmV3IFRyYW5zcG9ydEZhY3RvcnkodHJhbnNwb3J0T3B0aW9ucywgc2VydmljZU9wdGlvbnMpO1xuXG4gICAgdmFyIGdldEZpbmFsUGFyYW1zID0gZnVuY3Rpb24gKHBhcmFtcykge1xuICAgICAgICBpZiAodHlwZW9mIHBhcmFtcyA9PT0gJ29iamVjdCcpIHtcbiAgICAgICAgICAgIHJldHVybiAkLmV4dGVuZCh0cnVlLCBzZXJ2aWNlT3B0aW9ucywgcGFyYW1zKTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gc2VydmljZU9wdGlvbnM7XG4gICAgfTtcblxuICAgIHZhciBwYXRjaFVzZXJBY3RpdmVGaWVsZCA9IGZ1bmN0aW9uIChwYXJhbXMsIGFjdGl2ZSwgb3B0aW9ucykge1xuICAgICAgICB2YXIgaHR0cE9wdGlvbnMgPSAkLmV4dGVuZCh0cnVlLCBzZXJ2aWNlT3B0aW9ucywgb3B0aW9ucywge1xuICAgICAgICAgICAgdXJsOiB1cmxDb25maWcuZ2V0QVBJUGF0aChhcGlFbmRwb2ludCkgKyBwYXJhbXMuZ3JvdXBJZCArICcvJyArIHBhcmFtcy51c2VySWRcbiAgICAgICAgfSk7XG5cbiAgICAgICAgcmV0dXJuIGh0dHAucGF0Y2goeyBhY3RpdmU6IGFjdGl2ZSB9LCBodHRwT3B0aW9ucyk7XG4gICAgfTtcblxuICAgIHZhciBwdWJsaWNBUEkgPSB7XG5cbiAgICAgICAgZ2V0R3JvdXBzQnlVc2VyOiBmdW5jdGlvbiAocGFyYW1zLCBvcHRpb25zKSB7XG4gICAgICAgICAgICBvcHRpb25zID0gb3B0aW9ucyB8fCB7fTtcbiAgICAgICAgICAgIHZhciBodHRwT3B0aW9ucyA9ICQuZXh0ZW5kKHRydWUsIHNlcnZpY2VPcHRpb25zLCBvcHRpb25zKTtcbiAgICAgICAgICAgIHZhciBpc1N0cmluZyA9IHR5cGVvZiBwYXJhbXMgPT09ICdzdHJpbmcnO1xuICAgICAgICAgICAgdmFyIG9ialBhcmFtcyA9IGdldEZpbmFsUGFyYW1zKHBhcmFtcyk7XG4gICAgICAgICAgICBpZiAoIWlzU3RyaW5nICYmICFvYmpQYXJhbXMudXNlcklkKSB7XG4gICAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdObyB1c2VySWQgc3BlY2lmaWVkLicpO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICB2YXIgZ2V0UGFybXMgPSBpc1N0cmluZyA/IHsgdXNlcklkOiBwYXJhbXMgfSA6IF9waWNrKG9ialBhcmFtcywgJ3VzZXJJZCcpO1xuICAgICAgICAgICAgcmV0dXJuIGh0dHAuZ2V0KGdldFBhcm1zLCBodHRwT3B0aW9ucyk7XG4gICAgICAgIH0sXG5cbiAgICAgICAgZ2V0R3JvdXBEZXRhaWxzOiBmdW5jdGlvbiAocGFyYW1zLCBvcHRpb25zKSB7XG4gICAgICAgICAgICBvcHRpb25zID0gb3B0aW9ucyB8fCB7fTtcbiAgICAgICAgICAgIHZhciBpc1N0cmluZyA9IHR5cGVvZiBwYXJhbXMgPT09ICdzdHJpbmcnO1xuICAgICAgICAgICAgdmFyIG9ialBhcmFtcyA9IGdldEZpbmFsUGFyYW1zKHBhcmFtcyk7XG4gICAgICAgICAgICBpZiAoIWlzU3RyaW5nICYmICFvYmpQYXJhbXMuZ3JvdXBJZCkge1xuICAgICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcignTm8gZ3JvdXBJZCBzcGVjaWZpZWQuJyk7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIHZhciBncm91cElkID0gaXNTdHJpbmcgPyBwYXJhbXMgOiBvYmpQYXJhbXMuZ3JvdXBJZDtcbiAgICAgICAgICAgIHZhciBodHRwT3B0aW9ucyA9ICQuZXh0ZW5kKHRydWUsIHNlcnZpY2VPcHRpb25zLFxuICAgICAgICAgICAgICAgIG9wdGlvbnMsXG4gICAgICAgICAgICAgICAgeyB1cmw6IHVybENvbmZpZy5nZXRBUElQYXRoKGFwaUVuZHBvaW50KSArIGdyb3VwSWQgfVxuICAgICAgICAgICAgKTtcblxuICAgICAgICAgICAgcmV0dXJuIGh0dHAuZ2V0KHt9LCBodHRwT3B0aW9ucyk7XG4gICAgICAgIH0sXG5cbiAgICAgICAgbWFrZVVzZXJBY3RpdmU6IGZ1bmN0aW9uIChwYXJhbXMsIG9wdGlvbnMpIHtcbiAgICAgICAgICAgIHJldHVybiBwYXRjaFVzZXJBY3RpdmVGaWVsZChwYXJhbXMsIHRydWUsIG9wdGlvbnMpO1xuICAgICAgICB9LFxuXG4gICAgICAgIG1ha2VVc2VySW5hY3RpdmU6IGZ1bmN0aW9uIChwYXJhbXMsIG9wdGlvbnMpIHtcbiAgICAgICAgICAgIHJldHVybiBwYXRjaFVzZXJBY3RpdmVGaWVsZChwYXJhbXMsIGZhbHNlLCBvcHRpb25zKTtcbiAgICAgICAgfVxuICAgIH07XG5cbiAgICAkLmV4dGVuZCh0aGlzLCBwdWJsaWNBUEkpO1xufTtcbiIsIi8qKlxuICpcbiAqICMjUnVuIEFQSSBTZXJ2aWNlXG4gKlxuICogVGhlIFJ1biBBUEkgU2VydmljZSBhbGxvd3MgeW91IHRvIHBlcmZvcm0gY29tbW9uIHRhc2tzIGFyb3VuZCBjcmVhdGluZyBhbmQgdXBkYXRpbmcgcnVucywgdmFyaWFibGVzLCBhbmQgZGF0YS5cbiAqXG4gKiBBbGwgQVBJIGNhbGxzIHRha2UgaW4gYW4gXCJvcHRpb25zXCIgb2JqZWN0IGFzIHRoZSBsYXN0IHBhcmFtZXRlci4gVGhlIG9wdGlvbnMgY2FuIGJlIHVzZWQgdG8gZXh0ZW5kL292ZXJyaWRlIHRoZSBSdW4gQVBJIFNlcnZpY2UgZGVmYXVsdHMuXG4gKlxuICogVHlwaWNhbGx5LCB5b3UgZmlyc3QgaW5zdGFudGlhdGUgYSBbUnVuIE1hbmFnZXJdKC4uL3J1bi1tYW5hZ2VyLykgYW5kIHRoZW4gYWNjZXNzIHRoZSBSdW4gU2VydmljZSB0aGF0IGlzIGF1dG9tYXRpY2FsbHkgcGFydCBvZiB0aGUgbWFuYWdlci5cbiAqXG4gKiAgICAgICB2YXIgcm0gPSBuZXcgRi5tYW5hZ2VyLlJ1bk1hbmFnZXIoe1xuICogICAgICAgICAgIHJ1bjoge1xuICogICAgICAgICAgICAgICBhY2NvdW50OiAnYWNtZS1zaW11bGF0aW9ucycsXG4gKiAgICAgICAgICAgICAgIHByb2plY3Q6ICdzdXBwbHktY2hhaW4tZ2FtZScsXG4gKiAgICAgICAgICAgICAgIG1vZGVsOiAnc3VwcGx5LWNoYWluLW1vZGVsLmpsJ1xuICogICAgICAgICAgIH1cbiAqICAgICAgIH0pO1xuICogICAgICAgcm0uZ2V0UnVuKClcbiAqICAgICAgICAgICAudGhlbihmdW5jdGlvbigpIHtcbiAqICAgICAgICAgICAgICAgLy8gdGhlIFJ1bk1hbmFnZXIucnVuIGNvbnRhaW5zIHRoZSBpbnN0YW50aWF0ZWQgUnVuIFNlcnZpY2UsXG4gKiAgICAgICAgICAgICAgIC8vIHNvIGFueSBSdW4gU2VydmljZSBtZXRob2QgaXMgdmFsaWQgaGVyZVxuICogICAgICAgICAgICAgICB2YXIgcnMgPSBybS5ydW47XG4gKiAgICAgICAgICAgICAgIHJzLmRvKCdydW5Nb2RlbCcpO1xuICogICAgICAgfSlcbiAqXG4gKi9cblxuJ3VzZSBzdHJpY3QnO1xuXG52YXIgQ29uZmlnU2VydmljZSA9IHJlcXVpcmUoJy4vY29uZmlndXJhdGlvbi1zZXJ2aWNlJyk7XG52YXIgU3RvcmFnZUZhY3RvcnkgPSByZXF1aXJlKCcuLi9zdG9yZS9zdG9yZS1mYWN0b3J5Jyk7XG52YXIgcXV0aWwgPSByZXF1aXJlKCcuLi91dGlsL3F1ZXJ5LXV0aWwnKTtcbnZhciBydXRpbCA9IHJlcXVpcmUoJy4uL3V0aWwvcnVuLXV0aWwnKTtcbnZhciBfcGljayA9IHJlcXVpcmUoJy4uL3V0aWwvb2JqZWN0LXV0aWwnKS5fcGljaztcbnZhciBUcmFuc3BvcnRGYWN0b3J5ID0gcmVxdWlyZSgnLi4vdHJhbnNwb3J0L2h0dHAtdHJhbnNwb3J0LWZhY3RvcnknKTtcbnZhciBWYXJpYWJsZXNTZXJ2aWNlID0gcmVxdWlyZSgnLi92YXJpYWJsZXMtYXBpLXNlcnZpY2UnKTtcblxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbiAoY29uZmlnKSB7XG4gICAgLy8gY29uZmlnIHx8IChjb25maWcgPSBjb25maWdTZXJ2aWNlLmdldCgpKTtcbiAgICB2YXIgc3RvcmUgPSBuZXcgU3RvcmFnZUZhY3RvcnkoeyBzeW5jaHJvbm91czogdHJ1ZSB9KTtcblxuICAgIHZhciBkZWZhdWx0cyA9IHtcbiAgICAgICAgLyoqXG4gICAgICAgICAqIEZvciBwcm9qZWN0cyB0aGF0IHJlcXVpcmUgYXV0aGVudGljYXRpb24sIHBhc3MgaW4gdGhlIHVzZXIgYWNjZXNzIHRva2VuIChkZWZhdWx0cyB0byBlbXB0eSBzdHJpbmcpLiBJZiB0aGUgdXNlciBpcyBhbHJlYWR5IGxvZ2dlZCBpbiB0byBFcGljZW50ZXIsIHRoZSB1c2VyIGFjY2VzcyB0b2tlbiBpcyBhbHJlYWR5IHNldCBpbiBhIGNvb2tpZSBhbmQgYXV0b21hdGljYWxseSBsb2FkZWQgZnJvbSB0aGVyZS4gKFNlZSBbbW9yZSBiYWNrZ3JvdW5kIG9uIGFjY2VzcyB0b2tlbnNdKC4uLy4uLy4uL3Byb2plY3RfYWNjZXNzLykpLlxuICAgICAgICAgKiBAc2VlIFtBdXRoZW50aWNhdGlvbiBBUEkgU2VydmljZV0oLi4vYXV0aC1hcGktc2VydmljZS8pIGZvciBnZXR0aW5nIHRva2Vucy5cbiAgICAgICAgICogQHR5cGUge1N0cmluZ31cbiAgICAgICAgICovXG4gICAgICAgIHRva2VuOiBzdG9yZS5nZXQoJ2VwaWNlbnRlci5wcm9qZWN0LnRva2VuJykgfHwgJycsXG5cbiAgICAgICAgLyoqXG4gICAgICAgICAqIFRoZSBhY2NvdW50IGlkLiBJbiB0aGUgRXBpY2VudGVyIFVJLCB0aGlzIGlzIHRoZSAqKlRlYW0gSUQqKiAoZm9yIHRlYW0gcHJvamVjdHMpIG9yICoqVXNlciBJRCoqIChmb3IgcGVyc29uYWwgcHJvamVjdHMpLiBEZWZhdWx0cyB0byBlbXB0eSBzdHJpbmcuXG4gICAgICAgICAqIEB0eXBlIHtTdHJpbmd9XG4gICAgICAgICAqL1xuICAgICAgICBhY2NvdW50OiAnJyxcblxuICAgICAgICAvKipcbiAgICAgICAgICogVGhlIHByb2plY3QgaWQuIERlZmF1bHRzIHRvIGVtcHR5IHN0cmluZy5cbiAgICAgICAgICogQHR5cGUge1N0cmluZ31cbiAgICAgICAgICovXG4gICAgICAgIHByb2plY3Q6ICcnLFxuXG4gICAgICAgIC8qKlxuICAgICAgICAgKiBDcml0ZXJpYSBieSB3aGljaCB0byBmaWx0ZXIgcnVucy4gRGVmYXVsdHMgdG8gZW1wdHkgc3RyaW5nLlxuICAgICAgICAgKiBAdHlwZSB7U3RyaW5nfVxuICAgICAgICAgKi9cbiAgICAgICAgZmlsdGVyOiAnJyxcblxuICAgICAgICAvKipcbiAgICAgICAgICogQ2FsbGVkIHdoZW4gdGhlIGNhbGwgY29tcGxldGVzIHN1Y2Nlc3NmdWxseS4gRGVmYXVsdHMgdG8gYCQubm9vcGAuXG4gICAgICAgICAqL1xuICAgICAgICBzdWNjZXNzOiAkLm5vb3AsXG5cbiAgICAgICAgLyoqXG4gICAgICAgICAqIENhbGxlZCB3aGVuIHRoZSBjYWxsIGZhaWxzLiBEZWZhdWx0cyB0byBgJC5ub29wYC5cbiAgICAgICAgICovXG4gICAgICAgIGVycm9yOiAkLm5vb3AsXG5cbiAgICAgICAgLyoqXG4gICAgICAgICAqIE9wdGlvbnMgdG8gcGFzcyBvbiB0byB0aGUgdW5kZXJseWluZyB0cmFuc3BvcnQgbGF5ZXIuIEFsbCBqcXVlcnkuYWpheCBvcHRpb25zIGF0IGh0dHA6Ly9hcGkuanF1ZXJ5LmNvbS9qUXVlcnkuYWpheC8gYXJlIGF2YWlsYWJsZS4gRGVmYXVsdHMgdG8gZW1wdHkgb2JqZWN0LlxuICAgICAgICAgKiBAdHlwZSB7T2JqZWN0fVxuICAgICAgICAgKi9cbiAgICAgICAgdHJhbnNwb3J0OiB7fVxuICAgIH07XG5cbiAgICB2YXIgc2VydmljZU9wdGlvbnMgPSAkLmV4dGVuZCh7fSwgZGVmYXVsdHMsIGNvbmZpZyk7XG5cbiAgICB2YXIgdXJsQ29uZmlnID0gbmV3IENvbmZpZ1NlcnZpY2Uoc2VydmljZU9wdGlvbnMpLmdldCgnc2VydmVyJyk7XG4gICAgaWYgKHNlcnZpY2VPcHRpb25zLmFjY291bnQpIHtcbiAgICAgICAgdXJsQ29uZmlnLmFjY291bnRQYXRoID0gc2VydmljZU9wdGlvbnMuYWNjb3VudDtcbiAgICB9XG4gICAgaWYgKHNlcnZpY2VPcHRpb25zLnByb2plY3QpIHtcbiAgICAgICAgdXJsQ29uZmlnLnByb2plY3RQYXRoID0gc2VydmljZU9wdGlvbnMucHJvamVjdDtcbiAgICB9XG5cbiAgICB1cmxDb25maWcuZmlsdGVyID0gJzsnO1xuICAgIHVybENvbmZpZy5nZXRGaWx0ZXJVUkwgPSBmdW5jdGlvbiAoKSB7XG4gICAgICAgIHZhciB1cmwgPSB1cmxDb25maWcuZ2V0QVBJUGF0aCgncnVuJyk7XG4gICAgICAgIHZhciBmaWx0ZXIgPSBxdXRpbC50b01hdHJpeEZvcm1hdChzZXJ2aWNlT3B0aW9ucy5maWx0ZXIpO1xuXG4gICAgICAgIGlmIChmaWx0ZXIpIHtcbiAgICAgICAgICAgIHVybCArPSBmaWx0ZXIgKyAnLyc7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHVybDtcbiAgICB9O1xuXG4gICAgdmFyIGh0dHBPcHRpb25zID0gJC5leHRlbmQodHJ1ZSwge30sIHNlcnZpY2VPcHRpb25zLnRyYW5zcG9ydCwge1xuICAgICAgICB1cmw6IHVybENvbmZpZy5nZXRGaWx0ZXJVUkxcbiAgICB9KTtcblxuICAgIGlmIChzZXJ2aWNlT3B0aW9ucy50b2tlbikge1xuICAgICAgICBodHRwT3B0aW9ucy5oZWFkZXJzID0ge1xuICAgICAgICAgICAgJ0F1dGhvcml6YXRpb24nOiAnQmVhcmVyICcgKyBzZXJ2aWNlT3B0aW9ucy50b2tlblxuICAgICAgICB9O1xuICAgIH1cbiAgICB2YXIgaHR0cCA9IG5ldyBUcmFuc3BvcnRGYWN0b3J5KGh0dHBPcHRpb25zKTtcblxuICAgIHZhciBzZXRGaWx0ZXJPclRocm93RXJyb3IgPSBmdW5jdGlvbiAob3B0aW9ucykge1xuICAgICAgICBpZiAob3B0aW9ucy5maWx0ZXIpIHtcbiAgICAgICAgICAgIHNlcnZpY2VPcHRpb25zLmZpbHRlciA9IG9wdGlvbnMuZmlsdGVyO1xuICAgICAgICB9XG4gICAgICAgIGlmICghc2VydmljZU9wdGlvbnMuZmlsdGVyKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ05vIGZpbHRlciBzcGVjaWZpZWQgdG8gYXBwbHkgb3BlcmF0aW9ucyBhZ2FpbnN0Jyk7XG4gICAgICAgIH1cbiAgICB9O1xuXG4gICAgdmFyIHB1YmxpY0FzeW5jQVBJID0ge1xuICAgICAgICB1cmxDb25maWc6IHVybENvbmZpZyxcblxuICAgICAgICAvKipcbiAgICAgICAgICogQ3JlYXRlIGEgbmV3IHJ1bi5cbiAgICAgICAgICpcbiAgICAgICAgICogTk9URTogVHlwaWNhbGx5IHRoaXMgaXMgbm90IHVzZWQhIFVzZSBgUnVuTWFuYWdlci5nZXRSdW4oKWAgd2l0aCBhIGBzdHJhdGVneWAgb2YgYGFsd2F5cy1uZXdgLCBvciB1c2UgYFJ1bk1hbmFnZXIucmVzZXQoKWAuIFNlZSBbUnVuIE1hbmFnZXJdKC4uL3J1bi1tYW5hZ2VyLykgZm9yIG1vcmUgZGV0YWlscy5cbiAgICAgICAgICpcbiAgICAgICAgICogICoqRXhhbXBsZSoqXG4gICAgICAgICAqXG4gICAgICAgICAqICAgICAgcnMuY3JlYXRlKCdoZWxsb193b3JsZC5qbCcpO1xuICAgICAgICAgKlxuICAgICAgICAgKiAgKipQYXJhbWV0ZXJzKipcbiAgICAgICAgICogQHBhcmFtIHtTdHJpbmd9IGBtb2RlbGAgVGhlIG5hbWUgb2YgdGhlIHByaW1hcnkgW21vZGVsIGZpbGVdKC4uLy4uLy4uL3dyaXRpbmdfeW91cl9tb2RlbC8pLiBUaGlzIGlzIHRoZSBvbmUgZmlsZSBpbiB0aGUgcHJvamVjdCB0aGF0IGV4cGxpY2l0bHkgZXhwb3NlcyB2YXJpYWJsZXMgYW5kIG1ldGhvZHMsIGFuZCBpdCBtdXN0IGJlIHN0b3JlZCBpbiB0aGUgTW9kZWwgZm9sZGVyIG9mIHlvdXIgRXBpY2VudGVyIHByb2plY3QuXG4gICAgICAgICAqIEBwYXJhbSB7T2JqZWN0fSBgb3B0aW9uc2AgKE9wdGlvbmFsKSBPdmVycmlkZXMgZm9yIGNvbmZpZ3VyYXRpb24gb3B0aW9ucy5cbiAgICAgICAgICpcbiAgICAgICAgICovXG4gICAgICAgIGNyZWF0ZTogZnVuY3Rpb24gKHBhcmFtcywgb3B0aW9ucykge1xuICAgICAgICAgICAgdmFyIGNyZWF0ZU9wdGlvbnMgPSAkLmV4dGVuZCh0cnVlLCB7fSwgc2VydmljZU9wdGlvbnMsIG9wdGlvbnMsIHsgdXJsOiB1cmxDb25maWcuZ2V0QVBJUGF0aCgncnVuJykgfSk7XG4gICAgICAgICAgICB2YXIgcnVuQXBpUGFyYW1zID0gWydtb2RlbCcsICdzY29wZScsICdmaWxlcyddO1xuICAgICAgICAgICAgaWYgKHR5cGVvZiBwYXJhbXMgPT09ICdzdHJpbmcnKSB7XG4gICAgICAgICAgICAgICAgLy8gdGhpcyBpcyBqdXN0IHRoZSBtb2RlbCBuYW1lXG4gICAgICAgICAgICAgICAgcGFyYW1zID0geyBtb2RlbDogcGFyYW1zIH07XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIC8vIHdoaXRlbGlzdCB0aGUgZmllbGRzIHRoYXQgd2UgYWN0dWFsbHkgY2FuIHNlbmQgdG8gdGhlIGFwaVxuICAgICAgICAgICAgICAgIHBhcmFtcyA9IF9waWNrKHBhcmFtcywgcnVuQXBpUGFyYW1zKTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgdmFyIG9sZFN1Y2Nlc3MgPSBjcmVhdGVPcHRpb25zLnN1Y2Nlc3M7XG4gICAgICAgICAgICBjcmVhdGVPcHRpb25zLnN1Y2Nlc3MgPSBmdW5jdGlvbiAocmVzcG9uc2UpIHtcbiAgICAgICAgICAgICAgICBzZXJ2aWNlT3B0aW9ucy5maWx0ZXIgPSByZXNwb25zZS5pZDsgLy9hbGwgZnV0dXJlIGNoYWluZWQgY2FsbHMgdG8gb3BlcmF0ZSBvbiB0aGlzIGlkXG4gICAgICAgICAgICAgICAgcmV0dXJuIG9sZFN1Y2Nlc3MuYXBwbHkodGhpcywgYXJndW1lbnRzKTtcbiAgICAgICAgICAgIH07XG5cbiAgICAgICAgICAgIHJldHVybiBodHRwLnBvc3QocGFyYW1zLCBjcmVhdGVPcHRpb25zKTtcbiAgICAgICAgfSxcblxuICAgICAgICAvKipcbiAgICAgICAgICogUmV0dXJucyBwYXJ0aWN1bGFyIHJ1bnMsIGJhc2VkIG9uIGNvbmRpdGlvbnMgc3BlY2lmaWVkIGluIHRoZSBgcXNgIG9iamVjdC5cbiAgICAgICAgICpcbiAgICAgICAgICogVGhlIGVsZW1lbnRzIG9mIHRoZSBgcXNgIG9iamVjdCBhcmUgQU5EZWQgdG9nZXRoZXIgd2l0aGluIGEgc2luZ2xlIGNhbGwgdG8gYC5xdWVyeSgpYC5cbiAgICAgICAgICpcbiAgICAgICAgICogKipFeGFtcGxlKipcbiAgICAgICAgICpcbiAgICAgICAgICogICAgICAvLyByZXR1cm5zIHJ1bnMgd2l0aCBzYXZlZCA9IHRydWUgYW5kIHZhcmlhYmxlcy5wcmljZSA+IDEsXG4gICAgICAgICAqICAgICAgLy8gd2hlcmUgdmFyaWFibGVzLnByaWNlIGhhcyBiZWVuIHBlcnNpc3RlZCAocmVjb3JkZWQpXG4gICAgICAgICAqICAgICAgLy8gaW4gdGhlIG1vZGVsLlxuICAgICAgICAgKiAgICAgcnMucXVlcnkoe1xuICAgICAgICAgKiAgICAgICAgICAnc2F2ZWQnOiAndHJ1ZScsXG4gICAgICAgICAqICAgICAgICAgICcucHJpY2UnOiAnPjEnXG4gICAgICAgICAqICAgICAgIH0sXG4gICAgICAgICAqICAgICAgIHtcbiAgICAgICAgICogICAgICAgICAgc3RhcnRyZWNvcmQ6IDIsXG4gICAgICAgICAqICAgICAgICAgIGVuZHJlY29yZDogNVxuICAgICAgICAgKiAgICAgICB9KTtcbiAgICAgICAgICpcbiAgICAgICAgICogKipQYXJhbWV0ZXJzKipcbiAgICAgICAgICogQHBhcmFtIHtPYmplY3R9IGBxc2AgUXVlcnkgb2JqZWN0LiBFYWNoIGtleSBjYW4gYmUgYSBwcm9wZXJ0eSBvZiB0aGUgcnVuIG9yIHRoZSBuYW1lIG9mIHZhcmlhYmxlIHRoYXQgaGFzIGJlZW4gc2F2ZWQgaW4gdGhlIHJ1biAocHJlZmFjZWQgYnkgYHZhcmlhYmxlcy5gKS4gRWFjaCB2YWx1ZSBjYW4gYmUgYSBsaXRlcmFsIHZhbHVlLCBvciBhIGNvbXBhcmlzb24gb3BlcmF0b3IgYW5kIHZhbHVlLiAoU2VlIFttb3JlIG9uIGZpbHRlcmluZ10oLi4vLi4vLi4vcmVzdF9hcGlzL2FnZ3JlZ2F0ZV9ydW5fYXBpLyNmaWx0ZXJzKSBhbGxvd2VkIGluIHRoZSB1bmRlcmx5aW5nIFJ1biBBUEkuKSBRdWVyeWluZyBmb3IgdmFyaWFibGVzIGlzIGF2YWlsYWJsZSBmb3IgcnVucyBbaW4gbWVtb3J5XSguLi8uLi8uLi9ydW5fcGVyc2lzdGVuY2UvI3J1bnMtaW4tbWVtb3J5KSBhbmQgZm9yIHJ1bnMgW2luIHRoZSBkYXRhYmFzZV0oLi4vLi4vLi4vcnVuX3BlcnNpc3RlbmNlLyNydW5zLWluLW1lbW9yeSkgaWYgdGhlIHZhcmlhYmxlcyBhcmUgcGVyc2lzdGVkIChlLmcuIHRoYXQgaGF2ZSBiZWVuIGByZWNvcmRgZWQgaW4geW91ciBKdWxpYSBtb2RlbCkuXG4gICAgICAgICAqIEBwYXJhbSB7T2JqZWN0fSBgb3V0cHV0TW9kaWZpZXJgIChPcHRpb25hbCkgQXZhaWxhYmxlIGZpZWxkcyBpbmNsdWRlOiBgc3RhcnRyZWNvcmRgLCBgZW5kcmVjb3JkYCwgYHNvcnRgLCBhbmQgYGRpcmVjdGlvbmAgKGBhc2NgIG9yIGBkZXNjYCkuXG4gICAgICAgICAqIEBwYXJhbSB7T2JqZWN0fSBgb3B0aW9uc2AgKE9wdGlvbmFsKSBPdmVycmlkZXMgZm9yIGNvbmZpZ3VyYXRpb24gb3B0aW9ucy5cbiAgICAgICAgICovXG4gICAgICAgIHF1ZXJ5OiBmdW5jdGlvbiAocXMsIG91dHB1dE1vZGlmaWVyLCBvcHRpb25zKSB7XG4gICAgICAgICAgICBzZXJ2aWNlT3B0aW9ucy5maWx0ZXIgPSBxczsgLy9zaG91bGRuJ3QgYmUgYWJsZSB0byBvdmVyLXJpZGVcbiAgICAgICAgICAgIHZhciBodHRwT3B0aW9ucyA9ICQuZXh0ZW5kKHRydWUsIHt9LCBzZXJ2aWNlT3B0aW9ucywgb3B0aW9ucyk7XG4gICAgICAgICAgICByZXR1cm4gaHR0cC5nZXQob3V0cHV0TW9kaWZpZXIsIGh0dHBPcHRpb25zKTtcbiAgICAgICAgfSxcblxuICAgICAgICAvKipcbiAgICAgICAgICogUmV0dXJucyBwYXJ0aWN1bGFyIHJ1bnMsIGJhc2VkIG9uIGNvbmRpdGlvbnMgc3BlY2lmaWVkIGluIHRoZSBgcXNgIG9iamVjdC5cbiAgICAgICAgICpcbiAgICAgICAgICogU2ltaWxhciB0byBgLnF1ZXJ5KClgLlxuICAgICAgICAgKlxuICAgICAgICAgKiAqKlBhcmFtZXRlcnMqKlxuICAgICAgICAgKiBAcGFyYW0ge09iamVjdH0gYGZpbHRlcmAgRmlsdGVyIG9iamVjdC4gRWFjaCBrZXkgY2FuIGJlIGEgcHJvcGVydHkgb2YgdGhlIHJ1biBvciB0aGUgbmFtZSBvZiB2YXJpYWJsZSB0aGF0IGhhcyBiZWVuIHNhdmVkIGluIHRoZSBydW4gKHByZWZhY2VkIGJ5IGB2YXJpYWJsZXMuYCkuIEVhY2ggdmFsdWUgY2FuIGJlIGEgbGl0ZXJhbCB2YWx1ZSwgb3IgYSBjb21wYXJpc29uIG9wZXJhdG9yIGFuZCB2YWx1ZS4gKFNlZSBbbW9yZSBvbiBmaWx0ZXJpbmddKC4uLy4uLy4uL3Jlc3RfYXBpcy9hZ2dyZWdhdGVfcnVuX2FwaS8jZmlsdGVycykgYWxsb3dlZCBpbiB0aGUgdW5kZXJseWluZyBSdW4gQVBJLikgRmlsdGVyaW5nIGZvciB2YXJpYWJsZXMgaXMgYXZhaWxhYmxlIGZvciBydW5zIFtpbiBtZW1vcnldKC4uLy4uLy4uL3J1bl9wZXJzaXN0ZW5jZS8jcnVucy1pbi1tZW1vcnkpIGFuZCBmb3IgcnVucyBbaW4gdGhlIGRhdGFiYXNlXSguLi8uLi8uLi9ydW5fcGVyc2lzdGVuY2UvI3J1bnMtaW4tbWVtb3J5KSBpZiB0aGUgdmFyaWFibGVzIGFyZSBwZXJzaXN0ZWQgKGUuZy4gdGhhdCBoYXZlIGJlZW4gYHJlY29yZGBlZCBpbiB5b3VyIEp1bGlhIG1vZGVsKS5cbiAgICAgICAgICogQHBhcmFtIHtPYmplY3R9IGBvdXRwdXRNb2RpZmllcmAgKE9wdGlvbmFsKSBBdmFpbGFibGUgZmllbGRzIGluY2x1ZGU6IGBzdGFydHJlY29yZGAsIGBlbmRyZWNvcmRgLCBgc29ydGAsIGFuZCBgZGlyZWN0aW9uYCAoYGFzY2Agb3IgYGRlc2NgKS5cbiAgICAgICAgICogQHBhcmFtIHtPYmplY3R9IGBvcHRpb25zYCAoT3B0aW9uYWwpIE92ZXJyaWRlcyBmb3IgY29uZmlndXJhdGlvbiBvcHRpb25zLlxuICAgICAgICAgKi9cbiAgICAgICAgZmlsdGVyOiBmdW5jdGlvbiAoZmlsdGVyLCBvdXRwdXRNb2RpZmllciwgb3B0aW9ucykge1xuICAgICAgICAgICAgaWYgKCQuaXNQbGFpbk9iamVjdChzZXJ2aWNlT3B0aW9ucy5maWx0ZXIpKSB7XG4gICAgICAgICAgICAgICAgJC5leHRlbmQoc2VydmljZU9wdGlvbnMuZmlsdGVyLCBmaWx0ZXIpO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICBzZXJ2aWNlT3B0aW9ucy5maWx0ZXIgPSBmaWx0ZXI7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICB2YXIgaHR0cE9wdGlvbnMgPSAkLmV4dGVuZCh0cnVlLCB7fSwgc2VydmljZU9wdGlvbnMsIG9wdGlvbnMpO1xuICAgICAgICAgICAgcmV0dXJuIGh0dHAuZ2V0KG91dHB1dE1vZGlmaWVyLCBodHRwT3B0aW9ucyk7XG4gICAgICAgIH0sXG5cbiAgICAgICAgLyoqXG4gICAgICAgICAqIEdldCBkYXRhIGZvciBhIHNwZWNpZmljIHJ1bi4gVGhpcyBpbmNsdWRlcyBzdGFuZGFyZCBydW4gZGF0YSBzdWNoIGFzIHRoZSBhY2NvdW50LCBtb2RlbCwgcHJvamVjdCwgYW5kIGNyZWF0ZWQgYW5kIGxhc3QgbW9kaWZpZWQgZGF0ZXMuIFRvIHJlcXVlc3Qgc3BlY2lmaWMgbW9kZWwgdmFyaWFibGVzLCBwYXNzIHRoZW0gYXMgcGFydCBvZiB0aGUgYGZpbHRlcnNgIHBhcmFtZXRlci5cbiAgICAgICAgICpcbiAgICAgICAgICogTm90ZSB0aGF0IGlmIHRoZSBydW4gaXMgW2luIG1lbW9yeV0oLi4vLi4vLi4vcnVuX3BlcnNpc3RlbmNlLyNydW5zLWluLW1lbW9yeSksIGFueSBtb2RlbCB2YXJpYWJsZXMgYXJlIGF2YWlsYWJsZTsgaWYgdGhlIHJ1biBpcyBbaW4gdGhlIGRhdGFiYXNlXSguLi8uLi8uLi9ydW5fcGVyc2lzdGVuY2UvI3J1bnMtaW4tZGIpLCBvbmx5IG1vZGVsIHZhcmlhYmxlcyB0aGF0IGhhdmUgYmVlbiBwZXJzaXN0ZWQgJm1kYXNoOyB0aGF0IGlzLCBgcmVjb3JkYGVkIGluIHlvdXIgSnVsaWEgbW9kZWwgJm1kYXNoOyBhcmUgYXZhaWxhYmxlLlxuICAgICAgICAgKlxuICAgICAgICAgKiAqKkV4YW1wbGUqKlxuICAgICAgICAgKlxuICAgICAgICAgKiAgICAgcnMubG9hZCgnYmI1ODk2NzctZDQ3Ni00OTcxLWE2OGUtMGM1OGQxOTFlNDUwJywgeyBpbmNsdWRlOiBbJy5wcmljZScsICcuc2FsZXMnXSB9KTtcbiAgICAgICAgICpcbiAgICAgICAgICogKipQYXJhbWV0ZXJzKipcbiAgICAgICAgICogQHBhcmFtIHtTdHJpbmd9IGBydW5JRGAgVGhlIHJ1biBpZC5cbiAgICAgICAgICogQHBhcmFtIHtPYmplY3R9IGBmaWx0ZXJzYCAoT3B0aW9uYWwpIE9iamVjdCBjb250YWluaW5nIGZpbHRlcnMgYW5kIG9wZXJhdGlvbiBtb2RpZmllcnMuIFVzZSBrZXkgYGluY2x1ZGVgIHRvIGxpc3QgbW9kZWwgdmFyaWFibGVzIHRoYXQgeW91IHdhbnQgdG8gaW5jbHVkZSBpbiB0aGUgcmVzcG9uc2UuIE90aGVyIGF2YWlsYWJsZSBmaWVsZHMgaW5jbHVkZTogYHN0YXJ0cmVjb3JkYCwgYGVuZHJlY29yZGAsIGBzb3J0YCwgYW5kIGBkaXJlY3Rpb25gIChgYXNjYCBvciBgZGVzY2ApLlxuICAgICAgICAgKiBAcGFyYW0ge09iamVjdH0gYG9wdGlvbnNgIChPcHRpb25hbCkgT3ZlcnJpZGVzIGZvciBjb25maWd1cmF0aW9uIG9wdGlvbnMuXG4gICAgICAgICAqL1xuICAgICAgICBsb2FkOiBmdW5jdGlvbiAocnVuSUQsIGZpbHRlcnMsIG9wdGlvbnMpIHtcbiAgICAgICAgICAgIHNlcnZpY2VPcHRpb25zLmZpbHRlciA9IHJ1bklEOyAvL3Nob3VsZG4ndCBiZSBhYmxlIHRvIG92ZXItcmlkZVxuICAgICAgICAgICAgdmFyIGh0dHBPcHRpb25zID0gJC5leHRlbmQodHJ1ZSwge30sIHNlcnZpY2VPcHRpb25zLCBvcHRpb25zKTtcbiAgICAgICAgICAgIHJldHVybiBodHRwLmdldChmaWx0ZXJzLCBodHRwT3B0aW9ucyk7XG4gICAgICAgIH0sXG5cblxuICAgICAgICAvL1NhdmluZyBkYXRhXG4gICAgICAgIC8qKlxuICAgICAgICAgKiBTYXZlIGF0dHJpYnV0ZXMgKGRhdGEsIG1vZGVsIHZhcmlhYmxlcykgb2YgdGhlIHJ1bi5cbiAgICAgICAgICpcbiAgICAgICAgICogKipFeGFtcGxlcyoqXG4gICAgICAgICAqXG4gICAgICAgICAqICAgICBycy5zYXZlKHsgY29tcGxldGVkOiB0cnVlIH0pO1xuICAgICAgICAgKiAgICAgcnMuc2F2ZSh7IHNhdmVkOiB0cnVlLCB2YXJpYWJsZXM6IHsgYTogMjMsIGI6IDIzIH0gfSk7XG4gICAgICAgICAqXG4gICAgICAgICAqICoqUGFyYW1ldGVycyoqXG4gICAgICAgICAqIEBwYXJhbSB7T2JqZWN0fSBgYXR0cmlidXRlc2AgVGhlIHJ1biBkYXRhIGFuZCB2YXJpYWJsZXMgdG8gc2F2ZS4gTW9kZWwgdmFyaWFibGVzIG11c3QgYmUgaW5jbHVkZWQgaW4gYSBgdmFyaWFibGVzYCBmaWVsZCB3aXRoaW4gdGhlIGBhdHRyaWJ1dGVzYCBvYmplY3QgKG90aGVyd2lzZSB0aGV5IGFyZSB0cmVhdGVkIGFzIHJ1biBkYXRhIGFuZCBhZGRlZCB0byB0aGUgcnVuIHJlY29yZCBkaXJlY3RseSkuXG4gICAgICAgICAqIEBwYXJhbSB7T2JqZWN0fSBgb3B0aW9uc2AgKE9wdGlvbmFsKSBPdmVycmlkZXMgZm9yIGNvbmZpZ3VyYXRpb24gb3B0aW9ucy5cbiAgICAgICAgICovXG4gICAgICAgIHNhdmU6IGZ1bmN0aW9uIChhdHRyaWJ1dGVzLCBvcHRpb25zKSB7XG4gICAgICAgICAgICB2YXIgaHR0cE9wdGlvbnMgPSAkLmV4dGVuZCh0cnVlLCB7fSwgc2VydmljZU9wdGlvbnMsIG9wdGlvbnMpO1xuICAgICAgICAgICAgc2V0RmlsdGVyT3JUaHJvd0Vycm9yKGh0dHBPcHRpb25zKTtcbiAgICAgICAgICAgIHJldHVybiBodHRwLnBhdGNoKGF0dHJpYnV0ZXMsIGh0dHBPcHRpb25zKTtcbiAgICAgICAgfSxcblxuICAgICAgICAvLyMjT3BlcmF0aW9uc1xuICAgICAgICAvKipcbiAgICAgICAgICogQ2FsbCBhIG1ldGhvZCBmcm9tIHRoZSBtb2RlbC5cbiAgICAgICAgICpcbiAgICAgICAgICogRGVwZW5kaW5nIG9uIHRoZSBsYW5ndWFnZSBpbiB3aGljaCB5b3UgaGF2ZSB3cml0dGVuIHlvdXIgbW9kZWwsIHRoZSBtZXRob2QgbWF5IG5lZWQgdG8gYmUgZXhwb3NlZCAoZS5nLiBgZXhwb3J0YCBmb3IgYSBKdWxpYSBtb2RlbCkgaW4gdGhlIG1vZGVsIGZpbGUgaW4gb3JkZXIgdG8gYmUgY2FsbGVkIHRocm91Z2ggdGhlIEFQSS4gU2VlIFtXcml0aW5nIHlvdXIgTW9kZWxdKC4uLy4uLy4uL3dyaXRpbmdfeW91cl9tb2RlbC8pKS5cbiAgICAgICAgICpcbiAgICAgICAgICogVGhlIGBwYXJhbXNgIGFyZ3VtZW50IGlzIG5vcm1hbGx5IGFuIGFycmF5IG9mIGFyZ3VtZW50cyB0byB0aGUgYG9wZXJhdGlvbmAuIEluIHRoZSBzcGVjaWFsIGNhc2Ugd2hlcmUgYG9wZXJhdGlvbmAgb25seSB0YWtlcyBvbmUgYXJndW1lbnQsIHlvdSBhcmUgbm90IHJlcXVpcmVkIHRvIHB1dCB0aGF0IGFyZ3VtZW50IGludG8gYW4gYXJyYXkuXG4gICAgICAgICAqXG4gICAgICAgICAqIE5vdGUgdGhhdCB5b3UgY2FuIGNvbWJpbmUgdGhlIGBvcGVyYXRpb25gIGFuZCBgcGFyYW1zYCBhcmd1bWVudHMgaW50byBhIHNpbmdsZSBvYmplY3QgaWYgeW91IHByZWZlciwgYXMgaW4gdGhlIGxhc3QgZXhhbXBsZS5cbiAgICAgICAgICpcbiAgICAgICAgICogKipFeGFtcGxlcyoqXG4gICAgICAgICAqXG4gICAgICAgICAqICAgICAgLy8gbWV0aG9kIFwic29sdmVcIiB0YWtlcyBubyBhcmd1bWVudHNcbiAgICAgICAgICogICAgIHJzLmRvKCdzb2x2ZScpO1xuICAgICAgICAgKiAgICAgIC8vIG1ldGhvZCBcImVjaG9cIiB0YWtlcyBvbmUgYXJndW1lbnQsIGEgc3RyaW5nXG4gICAgICAgICAqICAgICBycy5kbygnZWNobycsIFsnaGVsbG8nXSk7XG4gICAgICAgICAqICAgICAgLy8gbWV0aG9kIFwiZWNob1wiIHRha2VzIG9uZSBhcmd1bWVudCwgYSBzdHJpbmdcbiAgICAgICAgICogICAgIHJzLmRvKCdlY2hvJywgJ2hlbGxvJyk7XG4gICAgICAgICAqICAgICAgLy8gbWV0aG9kIFwic3VtQXJyYXlcIiB0YWtlcyBvbmUgYXJndW1lbnQsIGFuIGFycmF5XG4gICAgICAgICAqICAgICBycy5kbygnc3VtQXJyYXknLCBbWzQsMiwxXV0pO1xuICAgICAgICAgKiAgICAgIC8vIG1ldGhvZCBcImFkZFwiIHRha2VzIHR3byBhcmd1bWVudHMsIGJvdGggaW50ZWdlcnNcbiAgICAgICAgICogICAgIHJzLmRvKHsgbmFtZTonYWRkJywgcGFyYW1zOlsyLDRdIH0pO1xuICAgICAgICAgKlxuICAgICAgICAgKiAqKlBhcmFtZXRlcnMqKlxuICAgICAgICAgKiBAcGFyYW0ge1N0cmluZ30gYG9wZXJhdGlvbmAgTmFtZSBvZiBtZXRob2QuXG4gICAgICAgICAqIEBwYXJhbSB7QXJyYXl9IGBwYXJhbXNgIChPcHRpb25hbCkgQW55IHBhcmFtZXRlcnMgdGhlIG9wZXJhdGlvbiB0YWtlcywgcGFzc2VkIGFzIGFuIGFycmF5LiBJbiB0aGUgc3BlY2lhbCBjYXNlIHdoZXJlIGBvcGVyYXRpb25gIG9ubHkgdGFrZXMgb25lIGFyZ3VtZW50LCB5b3UgYXJlIG5vdCByZXF1aXJlZCB0byBwdXQgdGhhdCBhcmd1bWVudCBpbnRvIGFuIGFycmF5LCBhbmQgY2FuIGp1c3QgcGFzcyBpdCBkaXJlY3RseS5cbiAgICAgICAgICogQHBhcmFtIHtPYmplY3R9IGBvcHRpb25zYCAoT3B0aW9uYWwpIE92ZXJyaWRlcyBmb3IgY29uZmlndXJhdGlvbiBvcHRpb25zLlxuICAgICAgICAgKi9cbiAgICAgICAgZG86IGZ1bmN0aW9uIChvcGVyYXRpb24sIHBhcmFtcywgb3B0aW9ucykge1xuICAgICAgICAgICAgLy8gY29uc29sZS5sb2coJ2RvJywgb3BlcmF0aW9uLCBwYXJhbXMpO1xuICAgICAgICAgICAgdmFyIG9wc0FyZ3M7XG4gICAgICAgICAgICB2YXIgcG9zdE9wdGlvbnM7XG4gICAgICAgICAgICBpZiAob3B0aW9ucykge1xuICAgICAgICAgICAgICAgIG9wc0FyZ3MgPSBwYXJhbXM7XG4gICAgICAgICAgICAgICAgcG9zdE9wdGlvbnMgPSBvcHRpb25zO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICBpZiAoJC5pc1BsYWluT2JqZWN0KHBhcmFtcykpIHtcbiAgICAgICAgICAgICAgICAgICAgb3BzQXJncyA9IG51bGw7XG4gICAgICAgICAgICAgICAgICAgIHBvc3RPcHRpb25zID0gcGFyYW1zO1xuICAgICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgICAgIG9wc0FyZ3MgPSBwYXJhbXM7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgdmFyIHJlc3VsdCA9IHJ1dGlsLm5vcm1hbGl6ZU9wZXJhdGlvbnMob3BlcmF0aW9uLCBvcHNBcmdzKTtcbiAgICAgICAgICAgIHZhciBodHRwT3B0aW9ucyA9ICQuZXh0ZW5kKHRydWUsIHt9LCBzZXJ2aWNlT3B0aW9ucywgcG9zdE9wdGlvbnMpO1xuXG4gICAgICAgICAgICBzZXRGaWx0ZXJPclRocm93RXJyb3IoaHR0cE9wdGlvbnMpO1xuXG4gICAgICAgICAgICB2YXIgcHJtcyA9IChyZXN1bHQuYXJnc1swXS5sZW5ndGggJiYgKHJlc3VsdC5hcmdzWzBdICE9PSBudWxsICYmIHJlc3VsdC5hcmdzWzBdICE9PSB1bmRlZmluZWQpKSA/IHJlc3VsdC5hcmdzWzBdIDogW107XG4gICAgICAgICAgICByZXR1cm4gaHR0cC5wb3N0KHsgYXJndW1lbnRzOiBwcm1zIH0sICQuZXh0ZW5kKHRydWUsIHt9LCBodHRwT3B0aW9ucywge1xuICAgICAgICAgICAgICAgIHVybDogdXJsQ29uZmlnLmdldEZpbHRlclVSTCgpICsgJ29wZXJhdGlvbnMvJyArIHJlc3VsdC5vcHNbMF0gKyAnLydcbiAgICAgICAgICAgIH0pKTtcbiAgICAgICAgfSxcblxuICAgICAgICAvKipcbiAgICAgICAgICogQ2FsbCBzZXZlcmFsIG1ldGhvZHMgZnJvbSB0aGUgbW9kZWwsIHNlcXVlbnRpYWxseS5cbiAgICAgICAgICpcbiAgICAgICAgICogRGVwZW5kaW5nIG9uIHRoZSBsYW5ndWFnZSBpbiB3aGljaCB5b3UgaGF2ZSB3cml0dGVuIHlvdXIgbW9kZWwsIHRoZSBtZXRob2RzIG1heSBuZWVkIHRvIGJlIGV4cG9zZWQgKGUuZy4gYGV4cG9ydGAgZm9yIGEgSnVsaWEgbW9kZWwpIGluIHRoZSBtb2RlbCBmaWxlIGluIG9yZGVyIHRvIGJlIGNhbGxlZCB0aHJvdWdoIHRoZSBBUEkuIFNlZSBbV3JpdGluZyB5b3VyIE1vZGVsXSguLi8uLi8uLi93cml0aW5nX3lvdXJfbW9kZWwvKSkuXG4gICAgICAgICAqXG4gICAgICAgICAqICoqRXhhbXBsZXMqKlxuICAgICAgICAgKlxuICAgICAgICAgKiAgICAgIC8vIG1ldGhvZHMgXCJpbml0aWFsaXplXCIgYW5kIFwic29sdmVcIiBkbyBub3QgdGFrZSBhbnkgYXJndW1lbnRzXG4gICAgICAgICAqICAgICBycy5zZXJpYWwoWydpbml0aWFsaXplJywgJ3NvbHZlJ10pO1xuICAgICAgICAgKiAgICAgIC8vIG1ldGhvZHMgXCJpbml0XCIgYW5kIFwicmVzZXRcIiB0YWtlIHR3byBhcmd1bWVudHMgZWFjaFxuICAgICAgICAgKiAgICAgcnMuc2VyaWFsKFsgIHsgbmFtZTogJ2luaXQnLCBwYXJhbXM6IFsxLDJdIH0sXG4gICAgICAgICAqICAgICAgICAgICAgICAgICAgeyBuYW1lOiAncmVzZXQnLCBwYXJhbXM6IFsyLDNdIH1dKTtcbiAgICAgICAgICogICAgICAvLyBtZXRob2QgXCJpbml0XCIgdGFrZXMgdHdvIGFyZ3VtZW50cyxcbiAgICAgICAgICogICAgICAvLyBtZXRob2QgXCJydW5tb2RlbFwiIHRha2VzIG5vbmVcbiAgICAgICAgICogICAgIHJzLnNlcmlhbChbICB7IG5hbWU6ICdpbml0JywgcGFyYW1zOiBbMSwyXSB9LFxuICAgICAgICAgKiAgICAgICAgICAgICAgICAgIHsgbmFtZTogJ3J1bm1vZGVsJywgcGFyYW1zOiBbXSB9XSk7XG4gICAgICAgICAqXG4gICAgICAgICAqICoqUGFyYW1ldGVycyoqXG4gICAgICAgICAqIEBwYXJhbSB7QXJyYXlbU3RyaW5nXXxBcnJheVtPYmplY3RdfSBgb3BlcmF0aW9uc2AgSWYgbm9uZSBvZiB0aGUgbWV0aG9kcyB0YWtlIHBhcmFtZXRlcnMsIHBhc3MgYW4gYXJyYXkgb2YgdGhlIG1ldGhvZCBuYW1lcyAoc3RyaW5ncykuIElmIGFueSBvZiB0aGUgbWV0aG9kcyBkbyB0YWtlIHBhcmFtZXRlcnMsIHBhc3MgYW4gYXJyYXkgb2Ygb2JqZWN0cywgZWFjaCBvZiB3aGljaCBjb250YWlucyBhIG1ldGhvZCBuYW1lIGFuZCBpdHMgb3duIChwb3NzaWJseSBlbXB0eSkgYXJyYXkgb2YgcGFyYW1ldGVycy5cbiAgICAgICAgICogQHBhcmFtIHtPYmplY3R9IGBvcHRpb25zYCAoT3B0aW9uYWwpIE92ZXJyaWRlcyBmb3IgY29uZmlndXJhdGlvbiBvcHRpb25zLlxuICAgICAgICAgKi9cbiAgICAgICAgc2VyaWFsOiBmdW5jdGlvbiAob3BlcmF0aW9ucywgcGFyYW1zLCBvcHRpb25zKSB7XG4gICAgICAgICAgICB2YXIgb3BQYXJhbXMgPSBydXRpbC5ub3JtYWxpemVPcGVyYXRpb25zKG9wZXJhdGlvbnMsIHBhcmFtcyk7XG4gICAgICAgICAgICB2YXIgb3BzID0gb3BQYXJhbXMub3BzO1xuICAgICAgICAgICAgdmFyIGFyZ3MgPSBvcFBhcmFtcy5hcmdzO1xuICAgICAgICAgICAgdmFyIG1lID0gdGhpcztcblxuICAgICAgICAgICAgdmFyICRkID0gJC5EZWZlcnJlZCgpO1xuICAgICAgICAgICAgdmFyIHBvc3RPcHRpb25zID0gJC5leHRlbmQodHJ1ZSwge30sIHNlcnZpY2VPcHRpb25zLCBvcHRpb25zKTtcblxuICAgICAgICAgICAgdmFyIGRvU2luZ2xlT3AgPSBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICAgICAgdmFyIG9wID0gb3BzLnNoaWZ0KCk7XG4gICAgICAgICAgICAgICAgdmFyIGFyZyA9IGFyZ3Muc2hpZnQoKTtcblxuICAgICAgICAgICAgICAgIG1lLmRvKG9wLCBhcmcsIHtcbiAgICAgICAgICAgICAgICAgICAgc3VjY2VzczogZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKG9wcy5sZW5ndGgpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBkb1NpbmdsZU9wKCk7XG4gICAgICAgICAgICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICRkLnJlc29sdmUuYXBwbHkodGhpcywgYXJndW1lbnRzKTtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBwb3N0T3B0aW9ucy5zdWNjZXNzLmFwcGx5KHRoaXMsIGFyZ3VtZW50cyk7XG4gICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgIGVycm9yOiBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAkZC5yZWplY3QuYXBwbHkodGhpcywgYXJndW1lbnRzKTtcbiAgICAgICAgICAgICAgICAgICAgICAgIHBvc3RPcHRpb25zLmVycm9yLmFwcGx5KHRoaXMsIGFyZ3VtZW50cyk7XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIH07XG5cbiAgICAgICAgICAgIGRvU2luZ2xlT3AoKTtcblxuICAgICAgICAgICAgcmV0dXJuICRkLnByb21pc2UoKTtcbiAgICAgICAgfSxcblxuICAgICAgICAvKipcbiAgICAgICAgICogQ2FsbCBzZXZlcmFsIG1ldGhvZHMgZnJvbSB0aGUgbW9kZWwsIGV4ZWN1dGluZyB0aGVtIGluIHBhcmFsbGVsLlxuICAgICAgICAgKlxuICAgICAgICAgKiBEZXBlbmRpbmcgb24gdGhlIGxhbmd1YWdlIGluIHdoaWNoIHlvdSBoYXZlIHdyaXR0ZW4geW91ciBtb2RlbCwgdGhlIG1ldGhvZHMgbWF5IG5lZWQgdG8gYmUgZXhwb3NlZCAoZS5nLiBgZXhwb3J0YCBmb3IgYSBKdWxpYSBtb2RlbCkgaW4gdGhlIG1vZGVsIGZpbGUgaW4gb3JkZXIgdG8gYmUgY2FsbGVkIHRocm91Z2ggdGhlIEFQSS4gU2VlIFtXcml0aW5nIHlvdXIgTW9kZWxdKC4uLy4uLy4uL3dyaXRpbmdfeW91cl9tb2RlbC8pKS5cbiAgICAgICAgICpcbiAgICAgICAgICogKipFeGFtcGxlKipcbiAgICAgICAgICpcbiAgICAgICAgICogICAgICAvLyBtZXRob2RzIFwic29sdmVcIiBhbmQgXCJyZXNldFwiIGRvIG5vdCB0YWtlIGFueSBhcmd1bWVudHNcbiAgICAgICAgICogICAgIHJzLnBhcmFsbGVsKFsnc29sdmUnLCAncmVzZXQnXSk7XG4gICAgICAgICAqICAgICAgLy8gbWV0aG9kcyBcImFkZFwiIGFuZCBcInN1YnRyYWN0XCIgdGFrZSB0d28gYXJndW1lbnRzIGVhY2hcbiAgICAgICAgICogICAgIHJzLnBhcmFsbGVsKFsgeyBuYW1lOiAnYWRkJywgcGFyYW1zOiBbMSwyXSB9LFxuICAgICAgICAgKiAgICAgICAgICAgICAgICAgICB7IG5hbWU6ICdzdWJ0cmFjdCcsIHBhcmFtczpbMiwzXSB9XSk7XG4gICAgICAgICAqICAgICAgLy8gbWV0aG9kcyBcImFkZFwiIGFuZCBcInN1YnRyYWN0XCIgdGFrZSB0d28gYXJndW1lbnRzIGVhY2hcbiAgICAgICAgICogICAgIHJzLnBhcmFsbGVsKHsgYWRkOiBbMSwyXSwgc3VidHJhY3Q6IFsyLDRdIH0pO1xuICAgICAgICAgKlxuICAgICAgICAgKiAqKlBhcmFtZXRlcnMqKlxuICAgICAgICAgKiBAcGFyYW0ge0FycmF5fE9iamVjdH0gYG9wZXJhdGlvbnNgIElmIG5vbmUgb2YgdGhlIG1ldGhvZHMgdGFrZSBwYXJhbWV0ZXJzLCBwYXNzIGFuIGFycmF5IG9mIHRoZSBtZXRob2QgbmFtZXMgKGFzIHN0cmluZ3MpLiBJZiBhbnkgb2YgdGhlIG1ldGhvZHMgZG8gdGFrZSBwYXJhbWV0ZXJzLCB5b3UgaGF2ZSB0d28gb3B0aW9ucy4gWW91IGNhbiBwYXNzIGFuIGFycmF5IG9mIG9iamVjdHMsIGVhY2ggb2Ygd2hpY2ggY29udGFpbnMgYSBtZXRob2QgbmFtZSBhbmQgaXRzIG93biAocG9zc2libHkgZW1wdHkpIGFycmF5IG9mIHBhcmFtZXRlcnMuIEFsdGVybmF0aXZlbHksIHlvdSBjYW4gcGFzcyBhIHNpbmdsZSBvYmplY3Qgd2l0aCB0aGUgbWV0aG9kIG5hbWUgYW5kIGEgKHBvc3NpYmx5IGVtcHR5KSBhcnJheSBvZiBwYXJhbWV0ZXJzLlxuICAgICAgICAgKiBAcGFyYW0ge09iamVjdH0gYG9wdGlvbnNgIChPcHRpb25hbCkgT3ZlcnJpZGVzIGZvciBjb25maWd1cmF0aW9uIG9wdGlvbnMuXG4gICAgICAgICAqL1xuICAgICAgICBwYXJhbGxlbDogZnVuY3Rpb24gKG9wZXJhdGlvbnMsIHBhcmFtcywgb3B0aW9ucykge1xuICAgICAgICAgICAgdmFyICRkID0gJC5EZWZlcnJlZCgpO1xuXG4gICAgICAgICAgICB2YXIgb3BQYXJhbXMgPSBydXRpbC5ub3JtYWxpemVPcGVyYXRpb25zKG9wZXJhdGlvbnMsIHBhcmFtcyk7XG4gICAgICAgICAgICB2YXIgb3BzID0gb3BQYXJhbXMub3BzO1xuICAgICAgICAgICAgdmFyIGFyZ3MgPSBvcFBhcmFtcy5hcmdzO1xuICAgICAgICAgICAgdmFyIHBvc3RPcHRpb25zID0gJC5leHRlbmQodHJ1ZSwge30sIHNlcnZpY2VPcHRpb25zLCBvcHRpb25zKTtcblxuICAgICAgICAgICAgdmFyIHF1ZXVlICA9IFtdO1xuICAgICAgICAgICAgZm9yICh2YXIgaSA9IDA7IGk8IG9wcy5sZW5ndGg7IGkrKykge1xuICAgICAgICAgICAgICAgIHF1ZXVlLnB1c2goXG4gICAgICAgICAgICAgICAgICAgIHRoaXMuZG8ob3BzW2ldLCBhcmdzW2ldKVxuICAgICAgICAgICAgICAgICk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICAkLndoZW4uYXBwbHkodGhpcywgcXVldWUpXG4gICAgICAgICAgICAgICAgLmRvbmUoZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgICAgICAgICAkZC5yZXNvbHZlLmFwcGx5KHRoaXMsIGFyZ3VtZW50cyk7XG4gICAgICAgICAgICAgICAgICAgIHBvc3RPcHRpb25zLnN1Y2Nlc3MuYXBwbHkodGhpcy5hcmd1bWVudHMpO1xuICAgICAgICAgICAgICAgIH0pXG4gICAgICAgICAgICAgICAgLmZhaWwoZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgICAgICAgICAkZC5yZWplY3QuYXBwbHkodGhpcywgYXJndW1lbnRzKTtcbiAgICAgICAgICAgICAgICAgICAgcG9zdE9wdGlvbnMuZXJyb3IuYXBwbHkodGhpcy5hcmd1bWVudHMpO1xuICAgICAgICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgICByZXR1cm4gJGQucHJvbWlzZSgpO1xuICAgICAgICB9XG4gICAgfTtcblxuICAgIHZhciBwdWJsaWNTeW5jQVBJID0ge1xuICAgICAgICAvKipcbiAgICAgICAgICogUmV0dXJucyBhIFZhcmlhYmxlcyBTZXJ2aWNlIGluc3RhbmNlLiBVc2UgdGhlIHZhcmlhYmxlcyBpbnN0YW5jZSB0byBsb2FkLCBzYXZlLCBhbmQgcXVlcnkgZm9yIHNwZWNpZmljIG1vZGVsIHZhcmlhYmxlcy4gU2VlIHRoZSBbVmFyaWFibGUgQVBJIFNlcnZpY2VdKC4uL3ZhcmlhYmxlcy1hcGktc2VydmljZS8pIGZvciBtb3JlIGluZm9ybWF0aW9uLlxuICAgICAgICAgKlxuICAgICAgICAgKiAqKkV4YW1wbGUqKlxuICAgICAgICAgKlxuICAgICAgICAgKiAgICAgIHZhciB2cyA9IHJzLnZhcmlhYmxlcygpO1xuICAgICAgICAgKiAgICAgIHZzLnNhdmUoeyBzYW1wbGVfaW50OiA0fSk7XG4gICAgICAgICAqXG4gICAgICAgICAqICoqUGFyYW1ldGVycyoqXG4gICAgICAgICAqIEBwYXJhbSB7T2JqZWN0fSBgY29uZmlnYCAoT3B0aW9uYWwpIE92ZXJyaWRlcyBmb3IgY29uZmlndXJhdGlvbiBvcHRpb25zLlxuICAgICAgICAgKi9cblxuICAgICAgICB2YXJpYWJsZXM6IGZ1bmN0aW9uIChjb25maWcpIHtcbiAgICAgICAgICAgIHZhciB2cyA9IG5ldyBWYXJpYWJsZXNTZXJ2aWNlKCQuZXh0ZW5kKHRydWUsIHt9LCBzZXJ2aWNlT3B0aW9ucywgY29uZmlnLCB7XG4gICAgICAgICAgICAgICAgcnVuU2VydmljZTogdGhpc1xuICAgICAgICAgICAgfSkpO1xuICAgICAgICAgICAgcmV0dXJuIHZzO1xuICAgICAgICB9XG4gICAgfTtcblxuICAgICQuZXh0ZW5kKHRoaXMsIHB1YmxpY0FzeW5jQVBJKTtcbiAgICAkLmV4dGVuZCh0aGlzLCBwdWJsaWNTeW5jQVBJKTtcbn07XG5cbiIsIid1c2Ugc3RyaWN0Jztcbi8qKlxuICogIyNTdGF0ZSBBUEkgQWRhcHRlclxuICpcbiAqIFRoZSBTdGF0ZSBBUEkgQWRhcHRlciBhbGxvd3MgeW91IHRvIHJlcGxheSBvciBjbG9uZSBydW5zXG4gKlxuICovXG5cbnZhciBDb25maWdTZXJ2aWNlID0gcmVxdWlyZSgnLi9jb25maWd1cmF0aW9uLXNlcnZpY2UnKTtcbnZhciBUcmFuc3BvcnRGYWN0b3J5ID0gcmVxdWlyZSgnLi4vdHJhbnNwb3J0L2h0dHAtdHJhbnNwb3J0LWZhY3RvcnknKTtcbnZhciBfcGljayA9IHJlcXVpcmUoJy4uL3V0aWwvb2JqZWN0LXV0aWwnKS5fcGljaztcbnZhciBhcGlFbmRwb2ludCA9ICdtb2RlbC9zdGF0ZSc7XG5cbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24gKGNvbmZpZykge1xuXG4gICAgdmFyIGRlZmF1bHRzID0ge1xuXG4gICAgfTtcblxuICAgIHZhciBzZXJ2aWNlT3B0aW9ucyA9ICQuZXh0ZW5kKHt9LCBkZWZhdWx0cywgY29uZmlnKTtcbiAgICB2YXIgdXJsQ29uZmlnID0gbmV3IENvbmZpZ1NlcnZpY2Uoc2VydmljZU9wdGlvbnMpLmdldCgnc2VydmVyJyk7XG5cbiAgICB2YXIgdHJhbnNwb3J0T3B0aW9ucyA9ICQuZXh0ZW5kKHRydWUsIHt9LCBzZXJ2aWNlT3B0aW9ucy50cmFuc3BvcnQsIHtcbiAgICAgICAgdXJsOiB1cmxDb25maWcuZ2V0QVBJUGF0aChhcGlFbmRwb2ludClcbiAgICB9KTtcblxuICAgIGlmIChzZXJ2aWNlT3B0aW9ucy50b2tlbikge1xuICAgICAgICB0cmFuc3BvcnRPcHRpb25zLmhlYWRlcnMgPSB7XG4gICAgICAgICAgICAnQXV0aG9yaXphdGlvbic6ICdCZWFyZXIgJyArIHNlcnZpY2VPcHRpb25zLnRva2VuXG4gICAgICAgIH07XG4gICAgfVxuXG4gICAgdmFyIGh0dHAgPSBuZXcgVHJhbnNwb3J0RmFjdG9yeSh0cmFuc3BvcnRPcHRpb25zKTtcblxuICAgIHZhciBwdWJsaWNBUEkgPSB7XG4gICAgICAgIC8qKlxuICAgICAgICAqIFJlcGxheXMgYSBydW4gdG8gZ2V0IGl0IGJhY2sgaW50byBtZW1vcnlcbiAgICAgICAgKlxuICAgICAgICAqXG4gICAgICAgICogKipQQVJBTUVURVJTKipcbiAgICAgICAgKiBAcGFyYW0ge29iamVjdH0gYHBhcmFtc2AgUGFyYW1ldGVycyBvYmplY3RcbiAgICAgICAgKiBAcGFyYW0ge3N0cmluZ30gYHBhcmFtcy5ydW5JZGAgaWQgb2YgdGhlIHJ1biB0byBicmluZyBiYWNrIHRvIG1lbW9yeVxuICAgICAgICAqIEBwYXJhbSB7c3RyaW5nfSAoT3B0aW9uYWwpIGBwYXJhbS5zdG9wQmVmb3JlYCAtIHRoZSBydW4gaXMgYWR2YW5jZWQgb25seSB1cCB0byB0aGUgZmlyc3Qgb2NjdXJyZW5jZSBvZiB0aGF0IG1ldGhvZFxuICAgICAgICAqIEBwYXJhbSB7b2JqZWN0fSAoT3B0aW9uYWwpIGBvcHRpb25zYCAtIE9wdGlvbnMgb3ZlcnJpZGVcbiAgICAgICAgKi9cbiAgICAgICAgcmVwbGF5OiBmdW5jdGlvbiAocGFyYW1zLCBvcHRpb25zKSB7XG4gICAgICAgICAgICB2YXIgcmVwbGF5T3B0aW9ucyA9ICQuZXh0ZW5kKHRydWUsIHt9LFxuICAgICAgICAgICAgICAgIHNlcnZpY2VPcHRpb25zLFxuICAgICAgICAgICAgICAgIG9wdGlvbnMsXG4gICAgICAgICAgICAgICAgeyB1cmw6IHVybENvbmZpZy5nZXRBUElQYXRoKGFwaUVuZHBvaW50KSArIHBhcmFtcy5ydW5JZCB9XG4gICAgICAgICAgICApO1xuXG4gICAgICAgICAgICBwYXJhbXMgPSAkLmV4dGVuZCh0cnVlLCB7IGFjdGlvbjogJ3JlcGxheScgfSwgX3BpY2socGFyYW1zLCAnc3RvcEJlZm9yZScpKTtcblxuICAgICAgICAgICAgcmV0dXJuIGh0dHAucG9zdChwYXJhbXMsIHJlcGxheU9wdGlvbnMpO1xuICAgICAgICB9LFxuXG4gICAgICAgIC8qKlxuICAgICAgICAqIENsb25lcyBhIGdpdmVuIHJ1biBhbmQgcmV0dXJucyBhIG5ldyBydW4gaW4gdGhlIHNhbWUgc3RhdGUgYXMgdGhlIGdpdmVuIHJ1blxuICAgICAgICAqXG4gICAgICAgICpcbiAgICAgICAgKiAqKlBBUkFNRVRFUlMqKlxuICAgICAgICAqIEBwYXJhbSB7b2JqZWN0fSBgcGFyYW1zYCBQYXJhbWV0ZXJzIG9iamVjdFxuICAgICAgICAqIEBwYXJhbSB7c3RyaW5nfSBgcGFyYW1zLnJ1bklkYCBpZCBvZiB0aGUgcnVuIHRvIGJyaW5nIGJhY2sgdG8gbWVtb3J5XG4gICAgICAgICogQHBhcmFtIHtzdHJpbmd9IChPcHRpb25hbCkgYHBhcmFtLnN0b3BCZWZvcmVgIC0gdGhlIHJ1biBpcyBhZHZhbmNlZCBvbmx5IHVwIHRvIHRoZSBmaXJzdCBvY2N1cnJlbmNlIG9mIHRoYXQgbWV0aG9kXG4gICAgICAgICogQHBhcmFtIHtvYmplY3R9IChPcHRpb25hbCkgYG9wdGlvbnNgIC0gT3B0aW9ucyBvdmVycmlkZVxuICAgICAgICAqL1xuICAgICAgICBjbG9uZTogZnVuY3Rpb24gKHBhcmFtcywgb3B0aW9ucykge1xuICAgICAgICAgICAgdmFyIHJlcGxheU9wdGlvbnMgPSAkLmV4dGVuZCh0cnVlLCB7fSxcbiAgICAgICAgICAgICAgICBzZXJ2aWNlT3B0aW9ucyxcbiAgICAgICAgICAgICAgICBvcHRpb25zLFxuICAgICAgICAgICAgICAgIHsgdXJsOiB1cmxDb25maWcuZ2V0QVBJUGF0aChhcGlFbmRwb2ludCkgKyBwYXJhbXMucnVuSWQgfVxuICAgICAgICAgICAgKTtcblxuICAgICAgICAgICAgcGFyYW1zID0gJC5leHRlbmQodHJ1ZSwgeyBhY3Rpb246ICdjbG9uZScgfSwgX3BpY2socGFyYW1zLCAnc3RvcEJlZm9yZScpKTtcblxuICAgICAgICAgICAgcmV0dXJuIGh0dHAucG9zdChwYXJhbXMsIHJlcGxheU9wdGlvbnMpO1xuICAgICAgICB9XG4gICAgfTtcblxuICAgICQuZXh0ZW5kKHRoaXMsIHB1YmxpY0FQSSk7XG59OyIsIid1c2Ugc3RyaWN0JztcblxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbiAoY29uZmlnKSB7XG4gICAgLy9UT0RPOiB1cmx1dGlscyB0byBnZXQgaG9zdCwgc2luY2Ugbm8gd2luZG93IG9uIG5vZGVcblxuICAgIHZhciBBUElfUFJPVE9DT0wgPSAnaHR0cHMnO1xuICAgIHZhciBIT1NUX0FQSV9NQVBQSU5HID0ge1xuICAgICAgICAnZm9yaW8uY29tJzogJ2FwaS5mb3Jpby5jb20nLFxuICAgICAgICAnZm9yaW9kZXYuY29tJzogJ2FwaS5lcGljZW50ZXIuZm9yaW9kZXYuY29tJ1xuICAgIH07XG5cbiAgICB2YXIgcHVibGljRXhwb3J0cyA9IHtcbiAgICAgICAgcHJvdG9jb2w6IEFQSV9QUk9UT0NPTCxcblxuICAgICAgICBhcGk6ICcnLFxuXG4gICAgICAgIGhvc3Q6IChmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICB2YXIgaG9zdCA9IHdpbmRvdy5sb2NhdGlvbi5ob3N0O1xuICAgICAgICAgICAgaWYgKCFob3N0IHx8IGhvc3QuaW5kZXhPZignbG9jYWwnKSAhPT0gLTEpIHtcbiAgICAgICAgICAgICAgICBob3N0ID0gJ2ZvcmlvLmNvbSc7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICByZXR1cm4gKEhPU1RfQVBJX01BUFBJTkdbaG9zdF0pID8gSE9TVF9BUElfTUFQUElOR1tob3N0XSA6ICdhcGkuJyArIGhvc3Q7XG4gICAgICAgIH0oKSksXG5cbiAgICAgICAgYXBwUGF0aDogKGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIHZhciBwYXRoID0gd2luZG93LmxvY2F0aW9uLnBhdGhuYW1lLnNwbGl0KCdcXC8nKTtcblxuICAgICAgICAgICAgcmV0dXJuIHBhdGggJiYgcGF0aFsxXSB8fCAnJztcbiAgICAgICAgfSgpKSxcblxuICAgICAgICBhY2NvdW50UGF0aDogKGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIHZhciBhY2NudCA9ICcnO1xuICAgICAgICAgICAgdmFyIHBhdGggPSB3aW5kb3cubG9jYXRpb24ucGF0aG5hbWUuc3BsaXQoJ1xcLycpO1xuICAgICAgICAgICAgaWYgKHBhdGggJiYgcGF0aFsxXSA9PT0gJ2FwcCcpIHtcbiAgICAgICAgICAgICAgICBhY2NudCA9IHBhdGhbMl07XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICByZXR1cm4gYWNjbnQ7XG4gICAgICAgIH0oKSksXG5cbiAgICAgICAgcHJvamVjdFBhdGg6IChmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICB2YXIgcHJqID0gJyc7XG4gICAgICAgICAgICB2YXIgcGF0aCA9IHdpbmRvdy5sb2NhdGlvbi5wYXRobmFtZS5zcGxpdCgnXFwvJyk7XG4gICAgICAgICAgICBpZiAocGF0aCAmJiBwYXRoWzFdID09PSAnYXBwJykge1xuICAgICAgICAgICAgICAgIHByaiA9IHBhdGhbM107XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICByZXR1cm4gcHJqO1xuICAgICAgICB9KCkpLFxuXG4gICAgICAgIGdldEFQSVBhdGg6IGZ1bmN0aW9uIChhcGkpIHtcbiAgICAgICAgICAgIHZhciBQUk9KRUNUX0FQSVMgPSBbJ3J1bicsICdkYXRhJ107XG4gICAgICAgICAgICB2YXIgYXBpUGF0aCA9IHRoaXMucHJvdG9jb2wgKyAnOi8vJyArIHRoaXMuaG9zdCArICcvJyArIGFwaSArICcvJztcblxuICAgICAgICAgICAgaWYgKCQuaW5BcnJheShhcGksIFBST0pFQ1RfQVBJUykgIT09IC0xKSB7XG4gICAgICAgICAgICAgICAgYXBpUGF0aCArPSB0aGlzLmFjY291bnRQYXRoICsgJy8nICsgdGhpcy5wcm9qZWN0UGF0aCAgKyAnLyc7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICByZXR1cm4gYXBpUGF0aDtcbiAgICAgICAgfVxuICAgIH07XG5cbiAgICAkLmV4dGVuZChwdWJsaWNFeHBvcnRzLCBjb25maWcpO1xuICAgIHJldHVybiBwdWJsaWNFeHBvcnRzO1xufTtcbiIsIid1c2Ugc3RyaWN0Jztcbi8qKlxuKiAjI1VzZXIgQVBJIEFkYXB0ZXJcbipcbiogVGhlIHVzZXIgQVBJIGFkYXB0ZXIgYWxsb3dzIHlvdSB0byBxdWVydCB0aGUgL3VzZXIgQVBJXG4qXG4qXG4qL1xuXG52YXIgQ29uZmlnU2VydmljZSA9IHJlcXVpcmUoJy4vY29uZmlndXJhdGlvbi1zZXJ2aWNlJyk7XG52YXIgVHJhbnNwb3J0RmFjdG9yeSA9IHJlcXVpcmUoJy4uL3RyYW5zcG9ydC9odHRwLXRyYW5zcG9ydC1mYWN0b3J5Jyk7XG52YXIgcXV0aWwgPSByZXF1aXJlKCcuLi91dGlsL3F1ZXJ5LXV0aWwnKTtcblxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbiAoY29uZmlnKSB7XG4gICAgdmFyIGRlZmF1bHRzID0ge1xuXG4gICAgICAgYWNjb3VudDogJycsXG5cbiAgICAgICB0b2tlbjogJycsXG5cbiAgICAgICAgLy9PcHRpb25zIHRvIHBhc3Mgb24gdG8gdGhlIHVuZGVybHlpbmcgdHJhbnNwb3J0IGxheWVyXG4gICAgICAgIHRyYW5zcG9ydDoge31cbiAgICB9O1xuXG4gICAgdmFyIHNlcnZpY2VPcHRpb25zID0gJC5leHRlbmQoe30sIGRlZmF1bHRzLCBjb25maWcpO1xuICAgIHZhciB1cmxDb25maWcgPSBuZXcgQ29uZmlnU2VydmljZShzZXJ2aWNlT3B0aW9ucykuZ2V0KCdzZXJ2ZXInKTtcbiAgICB2YXIgdHJhbnNwb3J0T3B0aW9ucyA9ICQuZXh0ZW5kKHRydWUsIHt9LCBzZXJ2aWNlT3B0aW9ucy50cmFuc3BvcnQsIHtcbiAgICAgICAgdXJsOiB1cmxDb25maWcuZ2V0QVBJUGF0aCgndXNlcicpXG4gICAgfSk7XG5cbiAgICBpZiAoc2VydmljZU9wdGlvbnMudG9rZW4pIHtcbiAgICAgICAgdHJhbnNwb3J0T3B0aW9ucy5oZWFkZXJzID0ge1xuICAgICAgICAgICAgJ0F1dGhvcml6YXRpb24nOiAnQmVhcmVyICcgKyBzZXJ2aWNlT3B0aW9ucy50b2tlblxuICAgICAgICB9O1xuICAgIH1cblxuICAgIHZhciBodHRwID0gbmV3IFRyYW5zcG9ydEZhY3RvcnkodHJhbnNwb3J0T3B0aW9ucyk7XG5cbiAgICB2YXIgcHVibGljQVBJID0ge1xuICAgICAgICBnZXQ6IGZ1bmN0aW9uIChmaWx0ZXIsIG9wdGlvbnMpIHtcbiAgICAgICAgICAgIG9wdGlvbnMgPSBvcHRpb25zIHx8IHt9O1xuICAgICAgICAgICAgZmlsdGVyID0gZmlsdGVyIHx8IHt9O1xuXG4gICAgICAgICAgICB2YXIgZ2V0T3B0aW9ucyA9ICQuZXh0ZW5kKHRydWUsIHt9LFxuICAgICAgICAgICAgICAgIHNlcnZpY2VPcHRpb25zLFxuICAgICAgICAgICAgICAgIG9wdGlvbnNcbiAgICAgICAgICAgICk7XG5cbiAgICAgICAgICAgIHZhciB0b1FGaWx0ZXIgPSBmdW5jdGlvbiAoZmlsdGVyKSB7XG4gICAgICAgICAgICAgICAgdmFyIHJlcyA9IHt9O1xuXG4gICAgICAgICAgICAgICAgLy8gQVBJIG9ubHkgc3VwcG9ydHMgZmlsdGVyaW5nIGJ5IHVzZXJuYW1lIGZvciBub3dcbiAgICAgICAgICAgICAgICBpZiAoZmlsdGVyLnVzZXJOYW1lKSB7XG4gICAgICAgICAgICAgICAgICAgIHJlcy5xID0gZmlsdGVyLnVzZXJOYW1lO1xuICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgIHJldHVybiByZXM7XG4gICAgICAgICAgICB9O1xuXG4gICAgICAgICAgICB2YXIgdG9JZEZpbHRlcnMgPSBmdW5jdGlvbiAoaWQpIHtcbiAgICAgICAgICAgICAgICBpZiAoIWlkKSB7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybiAnJztcbiAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICBpZCA9ICQuaXNBcnJheShpZCkgPyBpZCA6IFtpZF07XG4gICAgICAgICAgICAgICAgcmV0dXJuICdpZD0nICsgaWQuam9pbignJmlkPScpO1xuICAgICAgICAgICAgfTtcblxuICAgICAgICAgICAgdmFyIGdldEZpbHRlcnMgPSBbXG4gICAgICAgICAgICAgICAgJ2FjY291bnQ9JyArIGdldE9wdGlvbnMuYWNjb3VudCxcbiAgICAgICAgICAgICAgICB0b0lkRmlsdGVycyhmaWx0ZXIuaWQpLFxuICAgICAgICAgICAgICAgIHF1dGlsLnRvUXVlcnlGb3JtYXQodG9RRmlsdGVyKGZpbHRlcikpXG4gICAgICAgICAgICBdLmpvaW4oJyYnKTtcblxuICAgICAgICAgICAgLy8gc3BlY2lhbCBjYXNlIGZvciBxdWVyaWVzIHdpdGggbGFyZ2UgbnVtYmVyIG9mIGlkc1xuICAgICAgICAgICAgLy8gbWFrZSBpdCBhcyBhIHBvc3Qgd2l0aCBHRVQgc2VtYW50aWNzXG4gICAgICAgICAgICB2YXIgdGhyZXNob2xkID0gMzA7XG4gICAgICAgICAgICBpZiAoZmlsdGVyLmlkICYmICQuaXNBcnJheShmaWx0ZXIuaWQpICYmIGZpbHRlci5pZC5sZW5ndGggPj0gdGhyZXNob2xkKSB7XG4gICAgICAgICAgICAgICAgZ2V0T3B0aW9ucy51cmwgPSB1cmxDb25maWcuZ2V0QVBJUGF0aCgndXNlcicpICsgJz9fbWV0aG9kPUdFVCc7XG4gICAgICAgICAgICAgICAgcmV0dXJuIGh0dHAucG9zdCh7IGlkOiBmaWx0ZXIuaWQgfSwgZ2V0T3B0aW9ucyk7XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIHJldHVybiBodHRwLmdldChnZXRGaWx0ZXJzLCBnZXRPcHRpb25zKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSxcblxuICAgICAgICBnZXRCeUlkOiBmdW5jdGlvbiAodXNlcklkLCBvcHRpb25zKSB7XG4gICAgICAgICAgICByZXR1cm4gcHVibGljQVBJLmdldCh7IGlkOiB1c2VySWQgfSwgb3B0aW9ucyk7XG4gICAgICAgIH1cbiAgICB9O1xuXG4gICAgJC5leHRlbmQodGhpcywgcHVibGljQVBJKTtcbn07XG5cblxuXG5cbiIsIi8qKlxuICpcbiAqICMjVmFyaWFibGVzIEFQSSBTZXJ2aWNlXG4gKlxuICogVXNlZCBpbiBjb25qdW5jdGlvbiB3aXRoIHRoZSBbUnVuIEFQSSBTZXJ2aWNlXSguLi9ydW4tYXBpLXNlcnZpY2UvKSB0byByZWFkLCB3cml0ZSwgYW5kIHNlYXJjaCBmb3Igc3BlY2lmaWMgbW9kZWwgdmFyaWFibGVzLlxuICpcbiAqICAgICB2YXIgcm0gPSBuZXcgRi5tYW5hZ2VyLlJ1bk1hbmFnZXIoe1xuICogICAgICAgICAgIHJ1bjoge1xuICogICAgICAgICAgICAgICBhY2NvdW50OiAnYWNtZS1zaW11bGF0aW9ucycsXG4gKiAgICAgICAgICAgICAgIHByb2plY3Q6ICdzdXBwbHktY2hhaW4tZ2FtZScsXG4gKiAgICAgICAgICAgICAgIG1vZGVsOiAnc3VwcGx5LWNoYWluLW1vZGVsLmpsJ1xuICogICAgICAgICAgIH1cbiAqICAgICAgfSk7XG4gKiAgICAgcm0uZ2V0UnVuKClcbiAqICAgICAgIC50aGVuKGZ1bmN0aW9uKCkge1xuICogICAgICAgICAgdmFyIHZzID0gcm0ucnVuLnZhcmlhYmxlcygpO1xuICogICAgICAgICAgdnMuc2F2ZSh7c2FtcGxlX2ludDogNH0pO1xuICogICAgICAgIH0pO1xuICpcbiAqL1xuXG5cbiAndXNlIHN0cmljdCc7XG5cbiB2YXIgVHJhbnNwb3J0RmFjdG9yeSA9IHJlcXVpcmUoJy4uL3RyYW5zcG9ydC9odHRwLXRyYW5zcG9ydC1mYWN0b3J5Jyk7XG5cbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24gKGNvbmZpZykge1xuICAgIHZhciBkZWZhdWx0cyA9IHtcbiAgICAgICAgLyoqXG4gICAgICAgICAqIFRoZSBydW5zIG9iamVjdCB0byB3aGljaCB0aGUgdmFyaWFibGUgZmlsdGVycyBhcHBseS4gRGVmYXVsdHMgdG8gbnVsbC5cbiAgICAgICAgICogQHR5cGUge3J1blNlcnZpY2V9XG4gICAgICAgICAqL1xuICAgICAgICBydW5TZXJ2aWNlOiBudWxsXG4gICAgfTtcbiAgICB2YXIgc2VydmljZU9wdGlvbnMgPSAkLmV4dGVuZCh7fSwgZGVmYXVsdHMsIGNvbmZpZyk7XG5cbiAgICB2YXIgZ2V0VVJMID0gZnVuY3Rpb24gKCkge1xuICAgICAgICByZXR1cm4gc2VydmljZU9wdGlvbnMucnVuU2VydmljZS51cmxDb25maWcuZ2V0RmlsdGVyVVJMKCkgKyAndmFyaWFibGVzLyc7XG4gICAgfTtcblxuICAgIHZhciBodHRwT3B0aW9ucyA9IHtcbiAgICAgICAgdXJsOiBnZXRVUkxcbiAgICB9O1xuICAgIGlmIChzZXJ2aWNlT3B0aW9ucy50b2tlbikge1xuICAgICAgICBodHRwT3B0aW9ucy5oZWFkZXJzID0ge1xuICAgICAgICAgICAgJ0F1dGhvcml6YXRpb24nOiAnQmVhcmVyICcgKyBzZXJ2aWNlT3B0aW9ucy50b2tlblxuICAgICAgICB9O1xuICAgIH1cbiAgICB2YXIgaHR0cCA9IG5ldyBUcmFuc3BvcnRGYWN0b3J5KGh0dHBPcHRpb25zKTtcblxuICAgIHZhciBwdWJsaWNBUEkgPSB7XG5cbiAgICAgICAgLyoqXG4gICAgICAgICAqIEdldCB2YWx1ZXMgZm9yIGEgdmFyaWFibGUuXG4gICAgICAgICAqXG4gICAgICAgICAqICoqRXhhbXBsZSoqXG4gICAgICAgICAqXG4gICAgICAgICAqICAgICAgdnMubG9hZCgnc2FtcGxlX2ludCcpO1xuICAgICAgICAgKlxuICAgICAgICAgKiAqKlBhcmFtZXRlcnMqKlxuICAgICAgICAgKiBAcGFyYW0ge1N0cmluZ30gYHZhcmlhYmxlYCBOYW1lIG9mIHZhcmlhYmxlIHRvIGxvYWQuXG4gICAgICAgICAqIEBwYXJhbSB7T2JqZWN0fSBgb3V0cHV0TW9kaWZpZXJgIChPcHRpb25hbCkgQXZhaWxhYmxlIGZpZWxkcyBpbmNsdWRlOiBgc3RhcnRyZWNvcmRgLCBgZW5kcmVjb3JkYCwgYHNvcnRgLCBhbmQgYGRpcmVjdGlvbmAgKGBhc2NgIG9yIGBkZXNjYCkuXG4gICAgICAgICAqIEBwYXJhbSB7T2JqZWN0fSBgb3B0aW9uc2AgKE9wdGlvbmFsKSBPdmVycmlkZXMgZm9yIGNvbmZpZ3VyYXRpb24gb3B0aW9ucy5cbiAgICAgICAgICovXG4gICAgICAgIGxvYWQ6IGZ1bmN0aW9uICh2YXJpYWJsZSwgb3V0cHV0TW9kaWZpZXIsIG9wdGlvbnMpIHtcbiAgICAgICAgICAgIHZhciBodHRwT3B0aW9ucyA9ICQuZXh0ZW5kKHRydWUsIHt9LCBzZXJ2aWNlT3B0aW9ucywgb3B0aW9ucyk7XG4gICAgICAgICAgICByZXR1cm4gaHR0cC5nZXQob3V0cHV0TW9kaWZpZXIsICQuZXh0ZW5kKHt9LCBodHRwT3B0aW9ucywge1xuICAgICAgICAgICAgICAgIHVybDogZ2V0VVJMKCkgKyB2YXJpYWJsZSArICcvJ1xuICAgICAgICAgICAgfSkpO1xuICAgICAgICB9LFxuXG4gICAgICAgIC8qKlxuICAgICAgICAgKiBSZXR1cm5zIHBhcnRpY3VsYXIgdmFyaWFibGVzLCBiYXNlZCBvbiBjb25kaXRpb25zIHNwZWNpZmllZCBpbiB0aGUgYHF1ZXJ5YCBvYmplY3QuXG4gICAgICAgICAqXG4gICAgICAgICAqICoqRXhhbXBsZSoqXG4gICAgICAgICAqXG4gICAgICAgICAqICAgICAgdnMucXVlcnkoWydwcmljZScsICdzYWxlcyddKTtcbiAgICAgICAgICogICAgICB2cy5xdWVyeSh7IGluY2x1ZGU6WydwcmljZScsICdzYWxlcyddIH0pO1xuICAgICAgICAgKlxuICAgICAgICAgKiAqKlBhcmFtZXRlcnMqKlxuICAgICAgICAgKiBAcGFyYW0ge09iamVjdHxBcnJheX0gYHF1ZXJ5YCBUaGUgbmFtZXMgb2YgdGhlIHZhcmlhYmxlcyByZXF1ZXN0ZWQuXG4gICAgICAgICAqIEBwYXJhbSB7T2JqZWN0fSBgb3V0cHV0TW9kaWZpZXJgIChPcHRpb25hbCkgQXZhaWxhYmxlIGZpZWxkcyBpbmNsdWRlOiBgc3RhcnRyZWNvcmRgLCBgZW5kcmVjb3JkYCwgYHNvcnRgLCBhbmQgYGRpcmVjdGlvbmAgKGBhc2NgIG9yIGBkZXNjYCkuXG4gICAgICAgICAqIEBwYXJhbSB7T2JqZWN0fSBgb3B0aW9uc2AgKE9wdGlvbmFsKSBPdmVycmlkZXMgZm9yIGNvbmZpZ3VyYXRpb24gb3B0aW9ucy5cbiAgICAgICAgICpcbiAgICAgICAgICovXG4gICAgICAgIHF1ZXJ5OiBmdW5jdGlvbiAocXVlcnksIG91dHB1dE1vZGlmaWVyLCBvcHRpb25zKSB7XG4gICAgICAgICAgICAvL1F1ZXJ5IGFuZCBvdXRwdXRNb2RpZmllciBhcmUgYm90aCBxdWVyeXN0cmluZ3MgaW4gdGhlIHVybDsgb25seSBjYWxsaW5nIHRoZW0gb3V0IHNlcGFyYXRlbHkgaGVyZSB0byBiZSBjb25zaXN0ZW50IHdpdGggdGhlIG90aGVyIGNhbGxzXG4gICAgICAgICAgICB2YXIgaHR0cE9wdGlvbnMgPSAkLmV4dGVuZCh0cnVlLCB7fSwgc2VydmljZU9wdGlvbnMsIG9wdGlvbnMpO1xuXG4gICAgICAgICAgICBpZiAoJC5pc0FycmF5KHF1ZXJ5KSkge1xuICAgICAgICAgICAgICAgIHF1ZXJ5ID0geyBpbmNsdWRlOiBxdWVyeSB9O1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgJC5leHRlbmQocXVlcnksIG91dHB1dE1vZGlmaWVyKTtcbiAgICAgICAgICAgIHJldHVybiBodHRwLmdldChxdWVyeSwgaHR0cE9wdGlvbnMpO1xuICAgICAgICB9LFxuXG4gICAgICAgIC8qKlxuICAgICAgICAgKiBTYXZlIHZhbHVlcyB0byBtb2RlbCB2YXJpYWJsZXMuIE92ZXJ3cml0ZXMgZXhpc3RpbmcgdmFsdWVzLiBOb3RlIHRoYXQgeW91IGNhbiBvbmx5IHVwZGF0ZSBtb2RlbCB2YXJpYWJsZXMgaWYgdGhlIHJ1biBpcyBbaW4gbWVtb3J5XSguLi8uLi8uLi9ydW5fcGVyc2lzdGVuY2UvI3J1bnMtaW4tbWVtb3J5KS4gKEFuIGFsdGVybmF0ZSB3YXkgdG8gdXBkYXRlIG1vZGVsIHZhcmlhYmxlcyBpcyB0byBjYWxsIGEgbWV0aG9kIGZyb20gdGhlIG1vZGVsIGFuZCBtYWtlIHN1cmUgdGhhdCB0aGUgbWV0aG9kIHBlcnNpc3RzIHRoZSB2YXJpYWJsZXMuIFNlZSBgZG9gLCBgc2VyaWFsYCwgYW5kIGBwYXJhbGxlbGAgaW4gdGhlIFtSdW4gQVBJIFNlcnZpY2VdKC4uL3J1bi1hcGktc2VydmljZS8pIGZvciBjYWxsaW5nIG1ldGhvZHMgZnJvbSB0aGUgbW9kZWwuKVxuICAgICAgICAgKlxuICAgICAgICAgKiAqKkV4YW1wbGUqKlxuICAgICAgICAgKlxuICAgICAgICAgKiAgICAgIHZzLnNhdmUoJ3ByaWNlJywgNCk7XG4gICAgICAgICAqICAgICAgdnMuc2F2ZSh7IHByaWNlOiA0LCBxdWFudGl0eTogNSwgcHJvZHVjdHM6IFsyLDMsNF0gfSk7XG4gICAgICAgICAqXG4gICAgICAgICAqICoqUGFyYW1ldGVycyoqXG4gICAgICAgICAqIEBwYXJhbSB7T2JqZWN0fFN0cmluZ30gYHZhcmlhYmxlYCBBbiBvYmplY3QgY29tcG9zZWQgb2YgdGhlIG1vZGVsIHZhcmlhYmxlcyBhbmQgdGhlIHZhbHVlcyB0byBzYXZlLiBBbHRlcm5hdGl2ZWx5LCBhIHN0cmluZyB3aXRoIHRoZSBuYW1lIG9mIHRoZSB2YXJpYWJsZS5cbiAgICAgICAgICogQHBhcmFtIHtPYmplY3R9IGB2YWxgIChPcHRpb25hbCkgSWYgcGFzc2luZyBhIHN0cmluZyBmb3IgYHZhcmlhYmxlYCwgdXNlIHRoaXMgYXJndW1lbnQgZm9yIHRoZSB2YWx1ZSB0byBzYXZlLlxuICAgICAgICAgKiBAcGFyYW0ge09iamVjdH0gYG9wdGlvbnNgIChPcHRpb25hbCkgT3ZlcnJpZGVzIGZvciBjb25maWd1cmF0aW9uIG9wdGlvbnMuXG4gICAgICAgICAqL1xuICAgICAgICBzYXZlOiBmdW5jdGlvbiAodmFyaWFibGUsIHZhbCwgb3B0aW9ucykge1xuICAgICAgICAgICAgdmFyIGF0dHJzO1xuICAgICAgICAgICAgaWYgKHR5cGVvZiB2YXJpYWJsZSA9PT0gJ29iamVjdCcpIHtcbiAgICAgICAgICAgICAgICBhdHRycyA9IHZhcmlhYmxlO1xuICAgICAgICAgICAgICAgIG9wdGlvbnMgPSB2YWw7XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIChhdHRycyA9IHt9KVt2YXJpYWJsZV0gPSB2YWw7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICB2YXIgaHR0cE9wdGlvbnMgPSAkLmV4dGVuZCh0cnVlLCB7fSwgc2VydmljZU9wdGlvbnMsIG9wdGlvbnMpO1xuXG4gICAgICAgICAgICByZXR1cm4gaHR0cC5wYXRjaC5jYWxsKHRoaXMsIGF0dHJzLCBodHRwT3B0aW9ucyk7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBOb3QgQXZhaWxhYmxlIHVudGlsIHVuZGVybHlpbmcgQVBJIHN1cHBvcnRzIFBVVC4gT3RoZXJ3aXNlIHNhdmUgd291bGQgYmUgUFVUIGFuZCBtZXJnZSB3b3VsZCBiZSBQQVRDSFxuICAgICAgICAvLyAqXG4gICAgICAgIC8vICAqIFNhdmUgdmFsdWVzIHRvIHRoZSBhcGkuIE1lcmdlcyBhcnJheXMsIGJ1dCBvdGhlcndpc2Ugc2FtZSBhcyBzYXZlXG4gICAgICAgIC8vICAqIEBwYXJhbSB7T2JqZWN0fFN0cmluZ30gdmFyaWFibGUgT2JqZWN0IHdpdGggYXR0cmlidXRlcywgb3Igc3RyaW5nIGtleVxuICAgICAgICAvLyAgKiBAcGFyYW0ge09iamVjdH0gdmFsIE9wdGlvbmFsIGlmIHByZXYgcGFyYW1ldGVyIHdhcyBhIHN0cmluZywgc2V0IHZhbHVlIGhlcmVcbiAgICAgICAgLy8gICogQHBhcmFtIHtPYmplY3R9IG9wdGlvbnMgT3ZlcnJpZGVzIGZvciBjb25maWd1cmF0aW9uIG9wdGlvbnNcbiAgICAgICAgLy8gICpcbiAgICAgICAgLy8gICogQGV4YW1wbGVcbiAgICAgICAgLy8gICogICAgIHZzLm1lcmdlKHsgcHJpY2U6IDQsIHF1YW50aXR5OiA1LCBwcm9kdWN0czogWzIsMyw0XSB9KVxuICAgICAgICAvLyAgKiAgICAgdnMubWVyZ2UoJ3ByaWNlJywgNCk7XG5cbiAgICAgICAgLy8gbWVyZ2U6IGZ1bmN0aW9uICh2YXJpYWJsZSwgdmFsLCBvcHRpb25zKSB7XG4gICAgICAgIC8vICAgICB2YXIgYXR0cnM7XG4gICAgICAgIC8vICAgICBpZiAodHlwZW9mIHZhcmlhYmxlID09PSAnb2JqZWN0Jykge1xuICAgICAgICAvLyAgICAgICBhdHRycyA9IHZhcmlhYmxlO1xuICAgICAgICAvLyAgICAgICBvcHRpb25zID0gdmFsO1xuICAgICAgICAvLyAgICAgfSBlbHNlIHtcbiAgICAgICAgLy8gICAgICAgKGF0dHJzID0ge30pW3ZhcmlhYmxlXSA9IHZhbDtcbiAgICAgICAgLy8gICAgIH1cbiAgICAgICAgLy8gICAgIHZhciBodHRwT3B0aW9ucyA9ICQuZXh0ZW5kKHRydWUsIHt9LCBzZXJ2aWNlT3B0aW9ucywgb3B0aW9ucyk7XG5cbiAgICAgICAgLy8gICAgIHJldHVybiBodHRwLnBhdGNoLmNhbGwodGhpcywgYXR0cnMsIGh0dHBPcHRpb25zKTtcbiAgICAgICAgLy8gfVxuICAgIH07XG4gICAgJC5leHRlbmQodGhpcywgcHVibGljQVBJKTtcbn07XG4iLCIvKipcbiAqICMjV29ybGQgQVBJIEFkYXB0ZXJcbiAqXG4gKiBBIFtydW5dKC4uLy4uLy4uL2dsb3NzYXJ5LyNydW4pIGlzIGEgY29sbGVjdGlvbiBvZiBlbmQgdXNlciBpbnRlcmFjdGlvbnMgd2l0aCBhIHByb2plY3QgYW5kIGl0cyBtb2RlbCAtLSBpbmNsdWRpbmcgc2V0dGluZyB2YXJpYWJsZXMsIG1ha2luZyBkZWNpc2lvbnMsIGFuZCBjYWxsaW5nIG9wZXJhdGlvbnMuIEZvciBidWlsZGluZyBtdWx0aXBsYXllciBzaW11bGF0aW9ucyB5b3UgdHlwaWNhbGx5IHdhbnQgbXVsdGlwbGUgZW5kIHVzZXJzIHRvIHNoYXJlIHRoZSBzYW1lIHNldCBvZiBpbnRlcmFjdGlvbnMsIGFuZCB3b3JrIHdpdGhpbiBhIGNvbW1vbiBzdGF0ZS4gRXBpY2VudGVyIGFsbG93cyB5b3UgdG8gY3JlYXRlIFwid29ybGRzXCIgdG8gaGFuZGxlIHN1Y2ggY2FzZXMuXG4gKlxuICogVGhlIFdvcmxkIEFQSSBBZGFwdGVyIGFsbG93cyB5b3UgdG8gY3JlYXRlLCBhY2Nlc3MsIGFuZCBtYW5pcHVsYXRlIG11bHRpcGxheWVyIHdvcmxkcyB3aXRoaW4geW91ciBFcGljZW50ZXIgcHJvamVjdC4gWW91IGNhbiB1c2UgdGhpcyB0byBhZGQgYW5kIHJlbW92ZSBlbmQgdXNlcnMgZnJvbSB0aGUgd29ybGQsIGFuZCB0byBjcmVhdGUsIGFjY2VzcywgYW5kIHJlbW92ZSB0aGVpciBydW5zLiAoVGhlIHJlbGF0ZWQgW1dvcmxkIE1hbmFnZXJdKC4uL3dvcmxkLW1hbmFnZXIvKSBwcm92aWRlcyBhbiBlYXN5IHdheSB0byBhY2Nlc3MgcnVucyBhbmQgd29ybGRzIGZvciBwYXJ0aWN1bGFyIHVzZXJzLikgT25seSBbdGVhbSBwcm9qZWN0c10oLi4vLi4vLi4vZ2xvc3NhcnkvI3RlYW0pIGNhbiBiZSBtdWx0aXBsYXllci5cbiAqXG4gKiBBcyB3aXRoIGFsbCB0aGUgb3RoZXIgW0FQSSBBZGFwdGVyc10oLi4vLi4vKSwgYWxsIG1ldGhvZHMgdGFrZSBpbiBhbiBcIm9wdGlvbnNcIiBvYmplY3QgYXMgdGhlIGxhc3QgcGFyYW1ldGVyLiBUaGUgb3B0aW9ucyBjYW4gYmUgdXNlZCB0byBleHRlbmQvb3ZlcnJpZGUgdGhlIFdvcmxkIEFQSSBTZXJ2aWNlIGRlZmF1bHRzLlxuICpcbiAqIFR5cGljYWxseSwgeW91IGluc3RhbnRpYXRlIGEgV29ybGQgQWRhcHRlciBhbmQgdGhlbiBhY2Nlc3MgdGhlIG1ldGhvZHMgcHJvdmlkZWQuIEluc3RhbnRpYXRpbmcgcmVxdWlyZXMgdGhlIGFjY291bnQgaWQgKCoqVGVhbSBJRCoqIGluIHRoZSBFcGljZW50ZXIgdXNlciBpbnRlcmZhY2UpLCBwcm9qZWN0IGlkICgqKlByb2plY3QgSUQqKiksIGFuZCBncm91cCAoKipHcm91cCBOYW1lKiopLlxuICpcbiAqICAgICAgIHZhciB3YSA9IG5ldyBGLnNlcnZpY2UuV29ybGQoe1xuICogICAgICAgICAgYWNjb3VudDogJ2FjbWUtc2ltdWxhdGlvbnMnLFxuICogICAgICAgICAgcHJvamVjdDogJ3N1cHBseS1jaGFpbi1nYW1lJyxcbiAqICAgICAgICAgIGdyb3VwOiAndGVhbTEnIH0pO1xuICogICAgICAgd2EuY3JlYXRlKClcbiAqICAgICAgICAgIC50aGVuKGZ1bmN0aW9uKHdvcmxkKSB7XG4gKiAgICAgICAgICAgICAgLy8gY2FsbCBtZXRob2RzLCBlLmcuIHdhLmFkZFVzZXJzKClcbiAqICAgICAgICAgIH0pO1xuICovXG5cbid1c2Ugc3RyaWN0JztcblxudmFyIENvbmZpZ1NlcnZpY2UgPSByZXF1aXJlKCcuL2NvbmZpZ3VyYXRpb24tc2VydmljZScpO1xudmFyIFN0b3JhZ2VGYWN0b3J5ID0gcmVxdWlyZSgnLi4vc3RvcmUvc3RvcmUtZmFjdG9yeScpO1xuLy8gdmFyIHF1dGlsID0gcmVxdWlyZSgnLi4vdXRpbC9xdWVyeS11dGlsJyk7XG52YXIgVHJhbnNwb3J0RmFjdG9yeSA9IHJlcXVpcmUoJy4uL3RyYW5zcG9ydC9odHRwLXRyYW5zcG9ydC1mYWN0b3J5Jyk7XG52YXIgX3BpY2sgPSByZXF1aXJlKCcuLi91dGlsL29iamVjdC11dGlsJykuX3BpY2s7XG5cbnZhciBhcGlCYXNlID0gJ211bHRpcGxheWVyLyc7XG52YXIgYXNzaWdubWVudEVuZHBvaW50ID0gYXBpQmFzZSArICdhc3NpZ24nO1xudmFyIGFwaUVuZHBvaW50ID0gYXBpQmFzZSArICd3b3JsZCc7XG52YXIgcHJvamVjdEVuZHBvaW50ID0gYXBpQmFzZSArICdwcm9qZWN0JztcblxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbiAoY29uZmlnKSB7XG4gICAgdmFyIHN0b3JlID0gbmV3IFN0b3JhZ2VGYWN0b3J5KHsgc3luY2hyb25vdXM6IHRydWUgfSk7XG5cbiAgICB2YXIgZGVmYXVsdHMgPSB7XG4gICAgICAgIC8qKlxuICAgICAgICAgKiBGb3IgcHJvamVjdHMgdGhhdCByZXF1aXJlIGF1dGhlbnRpY2F0aW9uLCBwYXNzIGluIHRoZSB1c2VyIGFjY2VzcyB0b2tlbiAoZGVmYXVsdHMgdG8gZW1wdHkgc3RyaW5nKS4gSWYgdGhlIHVzZXIgaXMgYWxyZWFkeSBsb2dnZWQgaW4gdG8gRXBpY2VudGVyLCB0aGUgdXNlciBhY2Nlc3MgdG9rZW4gaXMgYWxyZWFkeSBzZXQgaW4gYSBjb29raWUgYW5kIGF1dG9tYXRpY2FsbHkgbG9hZGVkIGZyb20gdGhlcmUuIChTZWUgW21vcmUgYmFja2dyb3VuZCBvbiBhY2Nlc3MgdG9rZW5zXSguLi8uLi8uLi9wcm9qZWN0X2FjY2Vzcy8pKS5cbiAgICAgICAgICogQHNlZSBbQXV0aGVudGljYXRpb24gQVBJIFNlcnZpY2VdKC4uL2F1dGgtYXBpLXNlcnZpY2UvKSBmb3IgZ2V0dGluZyB0b2tlbnMuXG4gICAgICAgICAqIEB0eXBlIHtTdHJpbmd9XG4gICAgICAgICAqL1xuICAgICAgIHRva2VuOiBzdG9yZS5nZXQoJ2VwaWNlbnRlci5wcm9qZWN0LnRva2VuJykgfHwgJycsXG5cbiAgICAgICAgLyoqXG4gICAgICAgICAqIFRoZSBwcm9qZWN0IGlkLiBEZWZhdWx0cyB0byB1bmRlZmluZWQuXG4gICAgICAgICAqIEB0eXBlIHtTdHJpbmd9XG4gICAgICAgICAqL1xuICAgICAgIHByb2plY3Q6IHVuZGVmaW5lZCxcblxuICAgICAgICAvKipcbiAgICAgICAgICogVGhlIGFjY291bnQgaWQuIEluIHRoZSBFcGljZW50ZXIgVUksIHRoaXMgaXMgdGhlICoqVGVhbSBJRCoqIChmb3IgdGVhbSBwcm9qZWN0cykuIERlZmF1bHRzIHRvIHVuZGVmaW5lZC5cbiAgICAgICAgICogQHR5cGUge1N0cmluZ31cbiAgICAgICAgICovXG4gICAgICAgYWNjb3VudDogdW5kZWZpbmVkLFxuXG4gICAgICAgIC8qKlxuICAgICAgICAgKiBUaGUgZ3JvdXAgbmFtZS4gRGVmYXVsdHMgdG8gdW5kZWZpbmVkLlxuICAgICAgICAgKiBAdHlwZSB7U3RyaW5nfVxuICAgICAgICAgKi9cbiAgICAgICBncm91cDogdW5kZWZpbmVkLFxuXG4gICAgICAgLyoqXG4gICAgICAgICAqIFRoZSBtb2RlbCBmaWxlIHRvIHVzZSB0byBjcmVhdGUgcnVucyBpbiB0aGlzIHdvcmxkLiBEZWZhdWx0cyB0byB1bmRlZmluZWQuXG4gICAgICAgICAqIEB0eXBlIHtTdHJpbmd9XG4gICAgICAgICAqL1xuICAgICAgICBtb2RlbDogdW5kZWZpbmVkLFxuXG4vLyAgICAgICAgYXBpS2V5OiAnJyxcblxuLy8gICAgICAgIGRvbWFpbjogJ2ZvcmlvLmNvbScsXG5cbiAgICAgICAgLyoqXG4gICAgICAgICAqIE9wdGlvbnMgdG8gcGFzcyBvbiB0byB0aGUgdW5kZXJseWluZyB0cmFuc3BvcnQgbGF5ZXIuIEFsbCBqcXVlcnkuYWpheCBvcHRpb25zIGF0IGh0dHA6Ly9hcGkuanF1ZXJ5LmNvbS9qUXVlcnkuYWpheC8gYXJlIGF2YWlsYWJsZS4gRGVmYXVsdHMgdG8gZW1wdHkgb2JqZWN0LlxuICAgICAgICAgKiBAdHlwZSB7T2JqZWN0fVxuICAgICAgICAgKi9cbiAgICAgICAgdHJhbnNwb3J0OiB7fSxcblxuICAgICAgICAvKipcbiAgICAgICAgICogQ2FsbGVkIHdoZW4gdGhlIGNhbGwgY29tcGxldGVzIHN1Y2Nlc3NmdWxseS4gRGVmYXVsdHMgdG8gYCQubm9vcGAuXG4gICAgICAgICAqL1xuICAgICAgICBzdWNjZXNzOiAkLm5vb3AsXG5cbiAgICAgICAgLyoqXG4gICAgICAgICAqIENhbGxlZCB3aGVuIHRoZSBjYWxsIGZhaWxzLiBEZWZhdWx0cyB0byBgJC5ub29wYC5cbiAgICAgICAgICovXG4gICAgICAgIGVycm9yOiAkLm5vb3BcbiAgICB9O1xuXG4gICAgdmFyIHNlcnZpY2VPcHRpb25zID0gJC5leHRlbmQoe30sIGRlZmF1bHRzLCBjb25maWcpO1xuICAgIHZhciB1cmxDb25maWcgPSBuZXcgQ29uZmlnU2VydmljZShzZXJ2aWNlT3B0aW9ucykuZ2V0KCdzZXJ2ZXInKTtcblxuICAgIGlmICghc2VydmljZU9wdGlvbnMuYWNjb3VudCkge1xuICAgICAgICBzZXJ2aWNlT3B0aW9ucy5hY2NvdW50ID0gdXJsQ29uZmlnLmFjY291bnRQYXRoO1xuICAgIH1cblxuICAgIGlmICghc2VydmljZU9wdGlvbnMucHJvamVjdCkge1xuICAgICAgICBzZXJ2aWNlT3B0aW9ucy5wcm9qZWN0ID0gdXJsQ29uZmlnLnByb2plY3RQYXRoO1xuICAgIH1cblxuICAgIHZhciB0cmFuc3BvcnRPcHRpb25zID0gJC5leHRlbmQodHJ1ZSwge30sIHNlcnZpY2VPcHRpb25zLnRyYW5zcG9ydCwge1xuICAgICAgICB1cmw6IHVybENvbmZpZy5nZXRBUElQYXRoKGFwaUVuZHBvaW50KVxuICAgIH0pO1xuXG4gICAgaWYgKHNlcnZpY2VPcHRpb25zLnRva2VuKSB7XG4gICAgICAgIHRyYW5zcG9ydE9wdGlvbnMuaGVhZGVycyA9IHtcbiAgICAgICAgICAgICdBdXRob3JpemF0aW9uJzogJ0JlYXJlciAnICsgc2VydmljZU9wdGlvbnMudG9rZW5cbiAgICAgICAgfTtcbiAgICB9XG5cbiAgICB2YXIgaHR0cCA9IG5ldyBUcmFuc3BvcnRGYWN0b3J5KHRyYW5zcG9ydE9wdGlvbnMpO1xuXG4gICAgdmFyIHNldElkRmlsdGVyT3JUaHJvd0Vycm9yID0gZnVuY3Rpb24gKG9wdGlvbnMpIHtcbiAgICAgICAgaWYgKG9wdGlvbnMuZmlsdGVyKSB7XG4gICAgICAgICAgICBzZXJ2aWNlT3B0aW9ucy5maWx0ZXIgPSBvcHRpb25zLmZpbHRlcjtcbiAgICAgICAgfVxuICAgICAgICBpZiAoIXNlcnZpY2VPcHRpb25zLmZpbHRlcikge1xuICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdObyBmaWx0ZXIgc3BlY2lmaWVkIHRvIGFwcGx5IG9wZXJhdGlvbnMgYWdhaW5zdCcpO1xuICAgICAgICB9XG4gICAgfTtcblxuICAgIHZhciB2YWxpZGF0ZU1vZGVsT3JUaHJvd0Vycm9yID0gZnVuY3Rpb24gKG9wdGlvbnMpIHtcbiAgICAgICAgaWYgKCFvcHRpb25zLm1vZGVsKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ05vIG1vZGVsIHNwZWNpZmllZCB0byBnZXQgdGhlIGN1cnJlbnQgcnVuJyk7XG4gICAgICAgIH1cbiAgICB9O1xuXG4gICAgdmFyIHB1YmxpY0FQSSA9IHtcblxuICAgICAgICAvKipcbiAgICAgICAgKiBDcmVhdGUgYSBuZXcgV29ybGQuXG4gICAgICAgICpcbiAgICAgICAgKiAgKipFeGFtcGxlKipcbiAgICAgICAgKlxuICAgICAgICAqICAgICAgdmFyIHdhID0gbmV3IEYuc2VydmljZS5Xb3JsZCh7XG4gICAgICAgICogICAgICAgICAgIGFjY291bnQ6ICdhY21lLXNpbXVsYXRpb25zJyxcbiAgICAgICAgKiAgICAgICAgICAgcHJvamVjdDogJ3N1cHBseS1jaGFpbi1nYW1lJyxcbiAgICAgICAgKiAgICAgICAgICAgZ3JvdXA6ICd0ZWFtMScgfSk7XG4gICAgICAgICogICAgICB3YS5jcmVhdGUoe1xuICAgICAgICAqICAgICAgICAgICByb2xlczogWydWUCBNYXJrZXRpbmcnLCAnVlAgU2FsZXMnLCAnVlAgRW5naW5lZXJpbmcnXVxuICAgICAgICAqICAgICAgIH0pO1xuICAgICAgICAqXG4gICAgICAgICogICoqUGFyYW1ldGVycyoqXG4gICAgICAgICogQHBhcmFtIHtvYmplY3R9IGBwYXJhbXNgIFBhcmFtZXRlcnMgdG8gY3JlYXRlIHRoZSB3b3JsZC5cbiAgICAgICAgKiBAcGFyYW0ge3N0cmluZ30gYHBhcmFtcy5ncm91cGAgKE9wdGlvbmFsKSBUaGUgKipHcm91cCBOYW1lKiogdG8gY3JlYXRlIHRoaXMgd29ybGQgdW5kZXIuIE9ubHkgZW5kIHVzZXJzIGluIHRoaXMgZ3JvdXAgYXJlIGVsaWdpYmxlIHRvIGpvaW4gdGhlIHdvcmxkLiBPcHRpb25hbCBoZXJlOyByZXF1aXJlZCB3aGVuIGluc3RhbnRpYXRpbmcgdGhlIHNlcnZpY2UgKG5ldyBGLnNlcnZpY2UuV29ybGQoKSkuXG4gICAgICAgICogQHBhcmFtIHtvYmplY3R9IGBwYXJhbXMucm9sZXNgIChPcHRpb25hbCkgVGhlIGxpc3Qgb2Ygcm9sZXMgKHN0cmluZ3MpIGZvciB0aGlzIHdvcmxkLiBTb21lIHdvcmxkcyBoYXZlIHNwZWNpZmljIHJvbGVzIHRoYXQgKiptdXN0KiogYmUgZmlsbGVkIGJ5IGVuZCB1c2Vycy4gTGlzdGluZyB0aGUgcm9sZXMgYWxsb3dzIHlvdSB0byBhdXRvYXNzaWduIHVzZXJzIHRvIHdvcmxkcyBhbmQgZW5zdXJlIHRoYXQgYWxsIHJvbGVzIGFyZSBmaWxsZWQgaW4gZWFjaCB3b3JsZC5cbiAgICAgICAgKiBAcGFyYW0ge29iamVjdH0gYHBhcmFtcy5vcHRpb25hbFJvbGVzYCAoT3B0aW9uYWwpIFRoZSBsaXN0IG9mIG9wdGlvbmFsIHJvbGVzIChzdHJpbmdzKSBmb3IgdGhpcyB3b3JsZC4gU29tZSB3b3JsZHMgaGF2ZSBzcGVjaWZpYyByb2xlcyB0aGF0ICoqbWF5KiogYmUgZmlsbGVkIGJ5IGVuZCB1c2Vycy4gTGlzdGluZyB0aGUgb3B0aW9uYWwgcm9sZXMgYXMgcGFydCBvZiB0aGUgd29ybGQgb2JqZWN0IGFsbG93cyB5b3UgdG8gYXV0b2Fzc2lnbiB1c2VycyB0byB3b3JsZHMgYW5kIGVuc3VyZSB0aGF0IGFsbCByb2xlcyBhcmUgZmlsbGVkIGluIGVhY2ggd29ybGQuXG4gICAgICAgICogQHBhcmFtIHtpbnRlZ2VyfSBgcGFyYW1zLm1pblVzZXJzYCAoT3B0aW9uYWwpIFRoZSBtaW5pbXVtIG51bWJlciBvZiB1c2VycyBmb3IgdGhlIHdvcmxkLiBJbmNsdWRpbmcgdGhpcyBudW1iZXIgYWxsb3dzIHlvdSB0byBhdXRvYXNzaWduIGVuZCB1c2VycyB0byB3b3JsZHMgYW5kIGVuc3VyZSB0aGF0IHRoZSBjb3JyZWN0IG51bWJlciBvZiB1c2VycyBhcmUgaW4gZWFjaCB3b3JsZC5cbiAgICAgICAgKiBAcGFyYW0ge29iamVjdH0gYG9wdGlvbnNgIChPcHRpb25hbCkgT3B0aW9ucyBvYmplY3QgdG8gb3ZlcnJpZGUgZ2xvYmFsIG9wdGlvbnMuXG4gICAgICAgICpcbiAgICAgICAgKi9cbiAgICAgICAgY3JlYXRlOiBmdW5jdGlvbiAocGFyYW1zLCBvcHRpb25zKSB7XG4gICAgICAgICAgICB2YXIgY3JlYXRlT3B0aW9ucyA9ICQuZXh0ZW5kKHRydWUsIHt9LCBzZXJ2aWNlT3B0aW9ucywgb3B0aW9ucywgeyB1cmw6IHVybENvbmZpZy5nZXRBUElQYXRoKGFwaUVuZHBvaW50KSB9KTtcbiAgICAgICAgICAgIHZhciB3b3JsZEFwaVBhcmFtcyA9IFsnc2NvcGUnLCAnZmlsZXMnLCAncm9sZXMnLCAnb3B0aW9uYWxSb2xlcycsICdtaW5Vc2VycycsICdncm91cCcsICduYW1lJ107XG4gICAgICAgICAgICAvLyB3aGl0ZWxpc3QgdGhlIGZpZWxkcyB0aGF0IHdlIGFjdHVhbGx5IGNhbiBzZW5kIHRvIHRoZSBhcGlcbiAgICAgICAgICAgIHBhcmFtcyA9IF9waWNrKHBhcmFtcywgd29ybGRBcGlQYXJhbXMpO1xuXG4gICAgICAgICAgICAvLyBhY2NvdW50IGFuZCBwcm9qZWN0IGdvIGluIHRoZSBib2R5LCBub3QgaW4gdGhlIHVybFxuICAgICAgICAgICAgJC5leHRlbmQocGFyYW1zLCBfcGljayhzZXJ2aWNlT3B0aW9ucywgWydhY2NvdW50JywgJ3Byb2plY3QnLCAnZ3JvdXAnXSkpO1xuXG4gICAgICAgICAgICB2YXIgb2xkU3VjY2VzcyA9IGNyZWF0ZU9wdGlvbnMuc3VjY2VzcztcbiAgICAgICAgICAgIGNyZWF0ZU9wdGlvbnMuc3VjY2VzcyA9IGZ1bmN0aW9uIChyZXNwb25zZSkge1xuICAgICAgICAgICAgICAgIHNlcnZpY2VPcHRpb25zLmZpbHRlciA9IHJlc3BvbnNlLmlkOyAvL2FsbCBmdXR1cmUgY2hhaW5lZCBjYWxscyB0byBvcGVyYXRlIG9uIHRoaXMgaWRcbiAgICAgICAgICAgICAgICByZXR1cm4gb2xkU3VjY2Vzcy5hcHBseSh0aGlzLCBhcmd1bWVudHMpO1xuICAgICAgICAgICAgfTtcblxuICAgICAgICAgICAgcmV0dXJuIGh0dHAucG9zdChwYXJhbXMsIGNyZWF0ZU9wdGlvbnMpO1xuICAgICAgICB9LFxuXG4gICAgICAgIC8qKlxuICAgICAgICAqIFVwZGF0ZSBhIFdvcmxkLCBmb3IgZXhhbXBsZSB0byBhZGQgdGhlIHJvbGVzIHRvIHRoZSB3b3JsZC5cbiAgICAgICAgKlxuICAgICAgICAqICAqKkV4YW1wbGUqKlxuICAgICAgICAqXG4gICAgICAgICogICAgICB2YXIgd2EgPSBuZXcgRi5zZXJ2aWNlLldvcmxkKHtcbiAgICAgICAgKiAgICAgICAgICAgYWNjb3VudDogJ2FjbWUtc2ltdWxhdGlvbnMnLFxuICAgICAgICAqICAgICAgICAgICBwcm9qZWN0OiAnc3VwcGx5LWNoYWluLWdhbWUnLFxuICAgICAgICAqICAgICAgICAgICBncm91cDogJ3RlYW0xJyB9KTtcbiAgICAgICAgKiAgICAgIHdhLmNyZWF0ZSgpO1xuICAgICAgICAqICAgICAgICAgICAudGhlbihmdW5jdGlvbih3b3JsZCkge1xuICAgICAgICAqICAgICAgICAgICAgICAgd2EudXBkYXRlKHsgcm9sZXM6IFsnVlAgTWFya2V0aW5nJywgJ1ZQIFNhbGVzJywgJ1ZQIEVuZ2luZWVyaW5nJ10gfSk7XG4gICAgICAgICogICAgICAgICAgIH0pO1xuICAgICAgICAqXG4gICAgICAgICogICoqUGFyYW1ldGVycyoqXG4gICAgICAgICogQHBhcmFtIHtvYmplY3R9IGBwYXJhbXNgIFBhcmFtZXRlcnMgdG8gdXBkYXRlIHRoZSB3b3JsZC5cbiAgICAgICAgKiBAcGFyYW0ge3N0cmluZ30gYHBhcmFtcy5uYW1lYCBBIHN0cmluZyBpZGVudGlmaWVyIGZvciB0aGUgbGlua2VkIGVuZCB1c2VycywgZm9yIGV4YW1wbGUsIFwibmFtZVwiOiBcIk91ciBUZWFtXCIuXG4gICAgICAgICogQHBhcmFtIHtvYmplY3R9IGBwYXJhbXMucm9sZXNgIChPcHRpb25hbCkgVGhlIGxpc3Qgb2Ygcm9sZXMgKHN0cmluZ3MpIGZvciB0aGlzIHdvcmxkLiBTb21lIHdvcmxkcyBoYXZlIHNwZWNpZmljIHJvbGVzIHRoYXQgKiptdXN0KiogYmUgZmlsbGVkIGJ5IGVuZCB1c2Vycy4gTGlzdGluZyB0aGUgcm9sZXMgYWxsb3dzIHlvdSB0byBhdXRvYXNzaWduIHVzZXJzIHRvIHdvcmxkcyBhbmQgZW5zdXJlIHRoYXQgYWxsIHJvbGVzIGFyZSBmaWxsZWQgaW4gZWFjaCB3b3JsZC5cbiAgICAgICAgKiBAcGFyYW0ge29iamVjdH0gYHBhcmFtcy5vcHRpb25hbFJvbGVzYCAoT3B0aW9uYWwpIFRoZSBsaXN0IG9mIG9wdGlvbmFsIHJvbGVzIChzdHJpbmdzKSBmb3IgdGhpcyB3b3JsZC4gU29tZSB3b3JsZHMgaGF2ZSBzcGVjaWZpYyByb2xlcyB0aGF0ICoqbWF5KiogYmUgZmlsbGVkIGJ5IGVuZCB1c2Vycy4gTGlzdGluZyB0aGUgb3B0aW9uYWwgcm9sZXMgYXMgcGFydCBvZiB0aGUgd29ybGQgb2JqZWN0IGFsbG93cyB5b3UgdG8gYXV0b2Fzc2lnbiB1c2VycyB0byB3b3JsZHMgYW5kIGVuc3VyZSB0aGF0IGFsbCByb2xlcyBhcmUgZmlsbGVkIGluIGVhY2ggd29ybGQuXG4gICAgICAgICogQHBhcmFtIHtpbnRlZ2VyfSBgcGFyYW1zLm1pblVzZXJzYCAoT3B0aW9uYWwpIFRoZSBtaW5pbXVtIG51bWJlciBvZiB1c2VycyBmb3IgdGhlIHdvcmxkLiBJbmNsdWRpbmcgdGhpcyBudW1iZXIgYWxsb3dzIHlvdSB0byBhdXRvYXNzaWduIGVuZCB1c2VycyB0byB3b3JsZHMgYW5kIGVuc3VyZSB0aGF0IHRoZSBjb3JyZWN0IG51bWJlciBvZiB1c2VycyBhcmUgaW4gZWFjaCB3b3JsZC5cbiAgICAgICAgKiBAcGFyYW0ge29iamVjdH0gYG9wdGlvbnNgIChPcHRpb25hbCkgT3B0aW9ucyBvYmplY3QgdG8gb3ZlcnJpZGUgZ2xvYmFsIG9wdGlvbnMuXG4gICAgICAgICpcbiAgICAgICAgKi9cbiAgICAgICAgdXBkYXRlOiBmdW5jdGlvbiAocGFyYW1zLCBvcHRpb25zKSB7XG4gICAgICAgICAgICB2YXIgd2hpdGVsaXN0ID0gWydyb2xlcycsICdvcHRpb25hbFJvbGVzJywgJ21pblVzZXJzJ107XG4gICAgICAgICAgICBvcHRpb25zID0gb3B0aW9ucyB8fCB7fTtcbiAgICAgICAgICAgIHNldElkRmlsdGVyT3JUaHJvd0Vycm9yKG9wdGlvbnMpO1xuXG4gICAgICAgICAgICB2YXIgdXBkYXRlT3B0aW9ucyA9ICQuZXh0ZW5kKHRydWUsIHt9LFxuICAgICAgICAgICAgICAgIHNlcnZpY2VPcHRpb25zLFxuICAgICAgICAgICAgICAgIG9wdGlvbnMsXG4gICAgICAgICAgICAgICAgeyB1cmw6IHVybENvbmZpZy5nZXRBUElQYXRoKGFwaUVuZHBvaW50KSArIHNlcnZpY2VPcHRpb25zLmZpbHRlciB9XG4gICAgICAgICAgICApO1xuXG4gICAgICAgICAgICBwYXJhbXMgPSBfcGljayhwYXJhbXMgfHwge30sIHdoaXRlbGlzdCk7XG5cbiAgICAgICAgICAgIHJldHVybiBodHRwLnBhdGNoKHBhcmFtcywgdXBkYXRlT3B0aW9ucyk7XG4gICAgICAgIH0sXG5cbiAgICAgICAgLyoqXG4gICAgICAgICogRGVsZXRlIGFuIGV4aXN0aW5nIHdvcmxkLlxuICAgICAgICAqXG4gICAgICAgICogICoqRXhhbXBsZSoqXG4gICAgICAgICpcbiAgICAgICAgKiAgICAgIHZhciB3YSA9IG5ldyBGLnNlcnZpY2UuV29ybGQoe1xuICAgICAgICAqICAgICAgICAgICBhY2NvdW50OiAnYWNtZS1zaW11bGF0aW9ucycsXG4gICAgICAgICogICAgICAgICAgIHByb2plY3Q6ICdzdXBwbHktY2hhaW4tZ2FtZScsXG4gICAgICAgICogICAgICAgICAgIGdyb3VwOiAndGVhbTEnIH0pO1xuICAgICAgICAqICAgICAgd2EuY3JlYXRlKCk7XG4gICAgICAgICogICAgICAgICAgIC50aGVuKGZ1bmN0aW9uKHdvcmxkKSB7XG4gICAgICAgICogICAgICAgICAgICAgICB3YS5kZWxldGUoKTtcbiAgICAgICAgKiAgICAgICAgICAgfSk7XG4gICAgICAgICpcbiAgICAgICAgKiAgKipQYXJhbWV0ZXJzKipcbiAgICAgICAgKiBAcGFyYW0ge29iamVjdH0gYG9wdGlvbnNgIChPcHRpb25hbCkgT3B0aW9ucyBvYmplY3QgdG8gb3ZlcnJpZGUgZ2xvYmFsIG9wdGlvbnMuXG4gICAgICAgICpcbiAgICAgICAgKi9cbiAgICAgICAgZGVsZXRlOiBmdW5jdGlvbiAob3B0aW9ucykge1xuICAgICAgICAgICAgb3B0aW9ucyA9IG9wdGlvbnMgfHwge307XG4gICAgICAgICAgICBzZXRJZEZpbHRlck9yVGhyb3dFcnJvcihvcHRpb25zKTtcblxuICAgICAgICAgICAgdmFyIGRlbGV0ZU9wdGlvbnMgPSAkLmV4dGVuZCh0cnVlLCB7fSxcbiAgICAgICAgICAgICAgICBzZXJ2aWNlT3B0aW9ucyxcbiAgICAgICAgICAgICAgICBvcHRpb25zLFxuICAgICAgICAgICAgICAgIHsgdXJsOiB1cmxDb25maWcuZ2V0QVBJUGF0aChhcGlFbmRwb2ludCkgKyBzZXJ2aWNlT3B0aW9ucy5maWx0ZXIgfVxuICAgICAgICAgICAgKTtcblxuICAgICAgICAgICAgcmV0dXJuIGh0dHAuZGVsZXRlKG51bGwsIGRlbGV0ZU9wdGlvbnMpO1xuICAgICAgICB9LFxuXG4gICAgICAgIC8qKlxuICAgICAgICAqIFVwZGF0ZXMgdGhlIGNvbmZpZ3VyYXRpb24gZm9yIHRoZSBjdXJyZW50IGluc3RhbmNlIG9mIHRoZSB3b3JsZCBhZGFwdGVyXG4gICAgICAgICpcbiAgICAgICAgKiAqKkV4YW1wbGUqKlxuICAgICAgICAqIHZhciB3cyA9IG5ldyBGLnNlcnZpY2UuV29ybGQoey4uLn0pLnVwZGF0ZUNvbmZpZyh7IGZpbHRlcjogJzEyMycgfSkuYWRkVXNlcih7IHVzZXJJZDogJzEyMycgfSk7XG4gICAgICAgICpcbiAgICAgICAgKlxuICAgICAgICAqL1xuICAgICAgICB1cGRhdGVDb25maWc6IGZ1bmN0aW9uIChjb25maWcpIHtcbiAgICAgICAgICAgICQuZXh0ZW5kKHNlcnZpY2VPcHRpb25zLCBjb25maWcpO1xuXG4gICAgICAgICAgICByZXR1cm4gdGhpcztcbiAgICAgICAgfSxcblxuICAgICAgICAvKipcbiAgICAgICAgKiBMaXN0IGFsbCB3b3JsZHMgZm9yIGEgZ2l2ZW4gYWNjb3VudCwgcHJvamVjdCwgYW5kIGdyb3VwLiBBbGwgdGhyZWUgYXJlIHJlcXVpcmVkLCBhbmQgaWYgbm90IHNwZWNpZmllZCBhcyBwYXJhbWV0ZXJzLCBhcmUgcmVhZCBmcm9tIHRoZSBzZXJ2aWNlLlxuICAgICAgICAqXG4gICAgICAgICogICoqRXhhbXBsZSoqXG4gICAgICAgICpcbiAgICAgICAgKiAgICAgIHZhciB3YSA9IG5ldyBGLnNlcnZpY2UuV29ybGQoe1xuICAgICAgICAqICAgICAgICAgICBhY2NvdW50OiAnYWNtZS1zaW11bGF0aW9ucycsXG4gICAgICAgICogICAgICAgICAgIHByb2plY3Q6ICdzdXBwbHktY2hhaW4tZ2FtZScsXG4gICAgICAgICogICAgICAgICAgIGdyb3VwOiAndGVhbTEnIH0pO1xuICAgICAgICAqICAgICAgd2EuY3JlYXRlKCk7XG4gICAgICAgICogICAgICAgICAgIC50aGVuKGZ1bmN0aW9uKHdvcmxkKSB7XG4gICAgICAgICogICAgICAgICAgICAgICAvLyBsaXN0cyBhbGwgd29ybGRzIGluIGdyb3VwIFwidGVhbTFcIlxuICAgICAgICAqICAgICAgICAgICAgICAgd2EubGlzdCgpO1xuICAgICAgICAqXG4gICAgICAgICogICAgICAgICAgICAgICAvLyBsaXN0cyBhbGwgd29ybGRzIGluIGdyb3VwIFwib3RoZXItZ3JvdXAtbmFtZVwiXG4gICAgICAgICogICAgICAgICAgICAgICB3YS5saXN0KHsgZ3JvdXA6ICdvdGhlci1ncm91cC1uYW1lJyB9KTtcbiAgICAgICAgKiAgICAgICAgICAgfSk7XG4gICAgICAgICpcbiAgICAgICAgKiAgKipQYXJhbWV0ZXJzKipcbiAgICAgICAgKiBAcGFyYW0ge29iamVjdH0gYG9wdGlvbnNgIChPcHRpb25hbCkgT3B0aW9ucyBvYmplY3QgdG8gb3ZlcnJpZGUgZ2xvYmFsIG9wdGlvbnMuXG4gICAgICAgICpcbiAgICAgICAgKi9cbiAgICAgICAgbGlzdDogZnVuY3Rpb24gKG9wdGlvbnMpIHtcbiAgICAgICAgICAgIG9wdGlvbnMgPSBvcHRpb25zIHx8IHt9O1xuXG4gICAgICAgICAgICB2YXIgZ2V0T3B0aW9ucyA9ICQuZXh0ZW5kKHRydWUsIHt9LFxuICAgICAgICAgICAgICAgIHNlcnZpY2VPcHRpb25zLFxuICAgICAgICAgICAgICAgIG9wdGlvbnMsXG4gICAgICAgICAgICAgICAgeyB1cmw6IHVybENvbmZpZy5nZXRBUElQYXRoKGFwaUVuZHBvaW50KSB9XG4gICAgICAgICAgICApO1xuXG4gICAgICAgICAgICB2YXIgZmlsdGVycyA9IF9waWNrKGdldE9wdGlvbnMsIFsnYWNjb3VudCcsICdwcm9qZWN0JywgJ2dyb3VwJ10pO1xuXG4gICAgICAgICAgICByZXR1cm4gaHR0cC5nZXQoZmlsdGVycywgZ2V0T3B0aW9ucyk7XG4gICAgICAgIH0sXG5cbiAgICAgICAgLyoqXG4gICAgICAgICogR2V0IGFsbCB3b3JsZHMgdGhhdCBhbiBlbmQgdXNlciBiZWxvbmdzIHRvIGZvciBhIGdpdmVuIGFjY291bnQsIHByb2plY3QsIGFuZCBncm91cC5cbiAgICAgICAgKlxuICAgICAgICAqICAqKkV4YW1wbGUqKlxuICAgICAgICAqXG4gICAgICAgICogICAgICB2YXIgd2EgPSBuZXcgRi5zZXJ2aWNlLldvcmxkKHtcbiAgICAgICAgKiAgICAgICAgICAgYWNjb3VudDogJ2FjbWUtc2ltdWxhdGlvbnMnLFxuICAgICAgICAqICAgICAgICAgICBwcm9qZWN0OiAnc3VwcGx5LWNoYWluLWdhbWUnLFxuICAgICAgICAqICAgICAgICAgICBncm91cDogJ3RlYW0xJyB9KTtcbiAgICAgICAgKiAgICAgIHdhLmNyZWF0ZSgpO1xuICAgICAgICAqICAgICAgICAgICAudGhlbihmdW5jdGlvbih3b3JsZCkge1xuICAgICAgICAqICAgICAgICAgICAgICAgd2EuZ2V0V29ybGRzRm9yVXNlcignYjFjMTlkZGEtMmQyZS00Nzc3LWFkNWQtMzkyOWYxN2U4NmQzJylcbiAgICAgICAgKiAgICAgICAgICAgfSk7XG4gICAgICAgICpcbiAgICAgICAgKiAqKiBQYXJhbWV0ZXJzICoqXG4gICAgICAgICogQHBhcmFtIHtzdHJpbmd9IGB1c2VySWRgIFRoZSBgdXNlcklkYCBvZiB0aGUgdXNlciB3aG9zZSB3b3JsZHMgYXJlIGJlaW5nIHJldHJpZXZlZC5cbiAgICAgICAgKiBAcGFyYW0ge29iamVjdH0gYG9wdGlvbnNgIChPcHRpb25hbCkgT3B0aW9ucyBvYmplY3QgdG8gb3ZlcnJpZGUgZ2xvYmFsIG9wdGlvbnMuXG4gICAgICAgICovXG4gICAgICAgIGdldFdvcmxkc0ZvclVzZXI6IGZ1bmN0aW9uICh1c2VySWQsIG9wdGlvbnMpIHtcbiAgICAgICAgICAgIG9wdGlvbnMgPSBvcHRpb25zIHx8IHt9O1xuXG4gICAgICAgICAgICB2YXIgZ2V0T3B0aW9ucyA9ICQuZXh0ZW5kKHRydWUsIHt9LFxuICAgICAgICAgICAgICAgIHNlcnZpY2VPcHRpb25zLFxuICAgICAgICAgICAgICAgIG9wdGlvbnMsXG4gICAgICAgICAgICAgICAgeyB1cmw6IHVybENvbmZpZy5nZXRBUElQYXRoKGFwaUVuZHBvaW50KSB9XG4gICAgICAgICAgICApO1xuXG4gICAgICAgICAgICB2YXIgZmlsdGVycyA9ICQuZXh0ZW5kKFxuICAgICAgICAgICAgICAgIF9waWNrKGdldE9wdGlvbnMsIFsnYWNjb3VudCcsICdwcm9qZWN0JywgJ2dyb3VwJ10pLFxuICAgICAgICAgICAgICAgIHsgdXNlcklkOiB1c2VySWQgfVxuICAgICAgICAgICAgKTtcblxuICAgICAgICAgICAgcmV0dXJuIGh0dHAuZ2V0KGZpbHRlcnMsIGdldE9wdGlvbnMpO1xuICAgICAgICB9LFxuXG4gICAgICAgIC8qKlxuICAgICAgICAqIEFkZCBhbiBlbmQgdXNlciBvciBsaXN0IG9mIGVuZCB1c2VycyB0byBhIGdpdmVuIHdvcmxkLiBUaGUgZW5kIHVzZXIgbXVzdCBiZSBhIG1lbWJlciBvZiB0aGUgYGdyb3VwYCB0aGF0IGlzIGFzc29jaWF0ZWQgd2l0aCB0aGlzIHdvcmxkLlxuICAgICAgICAqXG4gICAgICAgICogICoqRXhhbXBsZSoqXG4gICAgICAgICpcbiAgICAgICAgKiAgICAgIHZhciB3YSA9IG5ldyBGLnNlcnZpY2UuV29ybGQoe1xuICAgICAgICAqICAgICAgICAgICBhY2NvdW50OiAnYWNtZS1zaW11bGF0aW9ucycsXG4gICAgICAgICogICAgICAgICAgIHByb2plY3Q6ICdzdXBwbHktY2hhaW4tZ2FtZScsXG4gICAgICAgICogICAgICAgICAgIGdyb3VwOiAndGVhbTEnIH0pO1xuICAgICAgICAqICAgICAgd2EuY3JlYXRlKCk7XG4gICAgICAgICogICAgICAgICAgIC50aGVuKGZ1bmN0aW9uKHdvcmxkKSB7XG4gICAgICAgICogICAgICAgICAgICAgICAvLyBhZGQgb25lIHVzZXJcbiAgICAgICAgKiAgICAgICAgICAgICAgIHdhLmFkZFVzZXJzKCdiMWMxOWRkYS0yZDJlLTQ3NzctYWQ1ZC0zOTI5ZjE3ZTg2ZDMnKTtcbiAgICAgICAgKiAgICAgICAgICAgICAgIHdhLmFkZFVzZXJzKFsnYjFjMTlkZGEtMmQyZS00Nzc3LWFkNWQtMzkyOWYxN2U4NmQzJ10pO1xuICAgICAgICAqICAgICAgICAgICAgICAgd2EuYWRkVXNlcnMoeyB1c2VySWQ6ICdiMWMxOWRkYS0yZDJlLTQ3NzctYWQ1ZC0zOTI5ZjE3ZTg2ZDMnLCByb2xlOiAnVlAgU2FsZXMnIH0pO1xuICAgICAgICAqXG4gICAgICAgICogICAgICAgICAgICAgICAvLyBhZGQgc2V2ZXJhbCB1c2Vyc1xuICAgICAgICAqICAgICAgICAgICAgICAgd2EuYWRkVXNlcnMoW1xuICAgICAgICAqICAgICAgICAgICAgICAgICAgIHsgdXNlcklkOiAnYTZmZTBjMWUtZjRiOC00ZjAxLTlmNWYtMDFjY2Y0YzJlZDQ0JyxcbiAgICAgICAgKiAgICAgICAgICAgICAgICAgICAgIHJvbGU6ICdWUCBNYXJrZXRpbmcnIH0sXG4gICAgICAgICogICAgICAgICAgICAgICAgICAgeyB1c2VySWQ6ICc4ZjI2MDRjZi05NmNkLTQ0OWYtODJmYS1lMzMxNTMwNzM0ZWUnLFxuICAgICAgICAqICAgICAgICAgICAgICAgICAgICAgcm9sZTogJ1ZQIEVuZ2luZWVyaW5nJyB9XG4gICAgICAgICogICAgICAgICAgICAgICBdKTtcbiAgICAgICAgKlxuICAgICAgICAqICAgICAgICAgICAgICAgLy8gYWRkIG9uZSB1c2VyIHRvIGEgc3BlY2lmaWMgd29ybGRcbiAgICAgICAgKiAgICAgICAgICAgICAgIHdhLmFkZFVzZXJzKCdiMWMxOWRkYS0yZDJlLTQ3NzctYWQ1ZC0zOTI5ZjE3ZTg2ZDMnLCB3b3JsZC5pZCk7XG4gICAgICAgICogICAgICAgICAgICAgICB3YS5hZGRVc2VycygnYjFjMTlkZGEtMmQyZS00Nzc3LWFkNWQtMzkyOWYxN2U4NmQzJywgeyBmaWx0ZXI6IHdvcmxkLmlkIH0pO1xuICAgICAgICAqICAgICAgICAgICB9KTtcbiAgICAgICAgKlxuICAgICAgICAqICoqIFBhcmFtZXRlcnMgKipcbiAgICAgICAgKiBAcGFyYW0ge3N0cmluZ3xvYmplY3R8YXJyYXl9IGB1c2Vyc2AgVXNlciBpZCwgYXJyYXkgb2YgdXNlciBpZHMsIG9iamVjdCwgb3IgYXJyYXkgb2Ygb2JqZWN0cyBvZiB0aGUgdXNlcnMgdG8gYWRkIHRvIHRoaXMgd29ybGQuXG4gICAgICAgICogQHBhcmFtIHtzdHJpbmd9IGB1c2Vycy5yb2xlYCBUaGUgYHJvbGVgIHRoZSB1c2VyIHNob3VsZCBoYXZlIGluIHRoZSB3b3JsZC4gSXQgaXMgdXAgdG8gdGhlIGNhbGxlciB0byBlbnN1cmUsIGlmIG5lZWRlZCwgdGhhdCB0aGUgYHJvbGVgIHBhc3NlZCBpbiBpcyBvbmUgb2YgdGhlIGByb2xlc2Agb3IgYG9wdGlvbmFsUm9sZXNgIG9mIHRoaXMgd29ybGQuXG4gICAgICAgICogQHBhcmFtIHtzdHJpbmd9IGB3b3JsZElkYCBUaGUgd29ybGQgdG8gd2hpY2ggdGhlIHVzZXJzIHNob3VsZCBiZSBhZGRlZC4gSWYgbm90IHNwZWNpZmllZCwgdGhlIGZpbHRlciBwYXJhbWV0ZXIgb2YgdGhlIGBvcHRpb25zYCBvYmplY3QgaXMgdXNlZC5cbiAgICAgICAgKiBAcGFyYW0ge29iamVjdH0gYG9wdGlvbnNgIChPcHRpb25hbCkgT3B0aW9ucyBvYmplY3QgdG8gb3ZlcnJpZGUgZ2xvYmFsIG9wdGlvbnMuXG4gICAgICAgICovXG4gICAgICAgIGFkZFVzZXJzOiBmdW5jdGlvbiAodXNlcnMsIHdvcmxkSWQsIG9wdGlvbnMpIHtcblxuICAgICAgICAgICAgaWYgKCF1c2Vycykge1xuICAgICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcignUGxlYXNlIHByb3ZpZGUgYSBsaXN0IG9mIHVzZXJzIHRvIGFkZCB0byB0aGUgd29ybGQnKTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgLy8gbm9ybWFsaXplIHRoZSBsaXN0IG9mIHVzZXJzIHRvIGFuIGFycmF5IG9mIHVzZXIgb2JqZWN0c1xuICAgICAgICAgICAgdXNlcnMgPSAkLm1hcChbXS5jb25jYXQodXNlcnMpLCBmdW5jdGlvbiAodSkge1xuICAgICAgICAgICAgICAgIHZhciBpc09iamVjdCA9ICQuaXNQbGFpbk9iamVjdCh1KTtcblxuICAgICAgICAgICAgICAgIGlmICh0eXBlb2YgdSAhPT0gJ3N0cmluZycgJiYgIWlzT2JqZWN0KSB7XG4gICAgICAgICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcignU29tZSBvZiB0aGUgdXNlcnMgaW4gdGhlIGxpc3QgYXJlIG5vdCBpbiB0aGUgdmFsaWQgZm9ybWF0OiAnICsgdSk7XG4gICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgcmV0dXJuIGlzT2JqZWN0ID8gdSA6IHsgdXNlcklkOiB1IH07XG4gICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgLy8gY2hlY2sgaWYgb3B0aW9ucyB3ZXJlIHBhc3NlZCBhcyB0aGUgc2Vjb25kIHBhcmFtZXRlclxuICAgICAgICAgICAgaWYgKCQuaXNQbGFpbk9iamVjdCh3b3JsZElkKSAmJiAhb3B0aW9ucykge1xuICAgICAgICAgICAgICAgIG9wdGlvbnMgPSB3b3JsZElkO1xuICAgICAgICAgICAgICAgIHdvcmxkSWQgPSBudWxsO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBvcHRpb25zID0gb3B0aW9ucyB8fCB7fTtcblxuICAgICAgICAgICAgLy8gd2UgbXVzdCBoYXZlIG9wdGlvbnMgYnkgbm93XG4gICAgICAgICAgICBpZiAodHlwZW9mIHdvcmxkSWQgPT09ICdzdHJpbmcnKSB7XG4gICAgICAgICAgICAgICAgb3B0aW9ucy5maWx0ZXIgPSB3b3JsZElkO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBzZXRJZEZpbHRlck9yVGhyb3dFcnJvcihvcHRpb25zKTtcblxuICAgICAgICAgICAgdmFyIHVwZGF0ZU9wdGlvbnMgPSAkLmV4dGVuZCh0cnVlLCB7fSxcbiAgICAgICAgICAgICAgICBzZXJ2aWNlT3B0aW9ucyxcbiAgICAgICAgICAgICAgICBvcHRpb25zLFxuICAgICAgICAgICAgICAgIHsgdXJsOiB1cmxDb25maWcuZ2V0QVBJUGF0aChhcGlFbmRwb2ludCkgKyBzZXJ2aWNlT3B0aW9ucy5maWx0ZXIgKyAnL3VzZXJzJyB9XG4gICAgICAgICAgICApO1xuXG4gICAgICAgICAgICByZXR1cm4gaHR0cC5wb3N0KHVzZXJzLCB1cGRhdGVPcHRpb25zKTtcbiAgICAgICAgfSxcblxuICAgICAgICAvKipcbiAgICAgICAgKiBVcGRhdGVzIGEgdXNlciBmcm9tIGEgZ2l2ZW4gd29ybGQgKG9ubHkgb25lIHVzZXIgYXQgYSB0aW1lKVxuICAgICAgICAqXG4gICAgICAgICogU3VwcG9ydGVkIGZvcm1hdHM6XG4gICAgICAgICogd3MudXBkYXRlVXNlcih7IHVzZXJJZDogJ2IxYzE5ZGRhLTJkMmUtNDc3Ny1hZDVkLTM5MjlmMTdlODZkMycsIHJvbGU6ICdsZWFkZXInIH0pO1xuICAgICAgICAqXG4gICAgICAgICogQHBhcmFtIHVzZXIge29iamVjdH0gdXNlciBvYmplY3Qgd2l0aCB1c2VySWQgYW5kIHRoZSBuZXcgcm9sZVxuICAgICAgICAqIEBwYXJhbSBvcHRpb25zIHtvYmplY3R9IChPcHRpb25hbCkgT3B0aW9ucyBvYmplY3QgdG8gb3ZlcnJpZGUgZ2xvYmFsIG9wdGlvbnNcbiAgICAgICAgKlxuICAgICAgICAqL1xuICAgICAgICB1cGRhdGVVc2VyOiBmdW5jdGlvbiAodXNlciwgb3B0aW9ucykge1xuICAgICAgICAgICAgb3B0aW9ucyA9IG9wdGlvbnMgfHwge307XG5cbiAgICAgICAgICAgIGlmICghdXNlciB8fCAhdXNlci51c2VySWQpIHtcbiAgICAgICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ1lvdSBuZWVkIHRvIHBhc3MgYSB1c2VySWQgdG8gdXBkYXRlIGZyb20gdGhlIHdvcmxkJyk7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIHNldElkRmlsdGVyT3JUaHJvd0Vycm9yKG9wdGlvbnMpO1xuXG4gICAgICAgICAgICB2YXIgcGF0Y2hPcHRpb25zID0gJC5leHRlbmQodHJ1ZSwge30sXG4gICAgICAgICAgICAgICAgc2VydmljZU9wdGlvbnMsXG4gICAgICAgICAgICAgICAgb3B0aW9ucyxcbiAgICAgICAgICAgICAgICB7IHVybDogdXJsQ29uZmlnLmdldEFQSVBhdGgoYXBpRW5kcG9pbnQpICsgc2VydmljZU9wdGlvbnMuZmlsdGVyICsgJy91c2Vycy8nICsgdXNlci51c2VySWQgfVxuICAgICAgICAgICAgKTtcblxuICAgICAgICAgICAgcmV0dXJuIGh0dHAucGF0Y2goX3BpY2sodXNlciwgJ3JvbGUnKSwgcGF0Y2hPcHRpb25zKTtcbiAgICAgICAgfSxcblxuICAgICAgICAvKipcbiAgICAgICAgKiBSZW1vdmUgYW4gZW5kIHVzZXIgZnJvbSBhIGdpdmVuIHdvcmxkLlxuICAgICAgICAqXG4gICAgICAgICogICoqRXhhbXBsZSoqXG4gICAgICAgICpcbiAgICAgICAgKiAgICAgIHZhciB3YSA9IG5ldyBGLnNlcnZpY2UuV29ybGQoe1xuICAgICAgICAqICAgICAgICAgICBhY2NvdW50OiAnYWNtZS1zaW11bGF0aW9ucycsXG4gICAgICAgICogICAgICAgICAgIHByb2plY3Q6ICdzdXBwbHktY2hhaW4tZ2FtZScsXG4gICAgICAgICogICAgICAgICAgIGdyb3VwOiAndGVhbTEnIH0pO1xuICAgICAgICAqICAgICAgd2EuY3JlYXRlKCk7XG4gICAgICAgICogICAgICAgICAgIC50aGVuKGZ1bmN0aW9uKHdvcmxkKSB7XG4gICAgICAgICogICAgICAgICAgICAgICB3YS5hZGRVc2VycyhcbiAgICAgICAgKiAgICAgICAgICAgICAgICAgICB7IHVzZXJJZDogJ2E2ZmUwYzFlLWY0YjgtNGYwMS05ZjVmLTAxY2NmNGMyZWQ0NCcgfSxcbiAgICAgICAgKiAgICAgICAgICAgICAgICAgICB7IHVzZXJJZDogJzhmMjYwNGNmLTk2Y2QtNDQ5Zi04MmZhLWUzMzE1MzA3MzRlZScgfVxuICAgICAgICAqICAgICAgICAgICAgICAgKTtcbiAgICAgICAgKiAgICAgICAgICAgICAgIHdhLnJlbW92ZVVzZXIoJ2E2ZmUwYzFlLWY0YjgtNGYwMS05ZjVmLTAxY2NmNGMyZWQ0NCcpO1xuICAgICAgICAqICAgICAgICAgICAgICAgd2EucmVtb3ZlVXNlcih7IHVzZXJJZDogJzhmMjYwNGNmLTk2Y2QtNDQ5Zi04MmZhLWUzMzE1MzA3MzRlZScgfSk7XG4gICAgICAgICogICAgICAgICAgIH0pO1xuICAgICAgICAqXG4gICAgICAgICogKiogUGFyYW1ldGVycyAqKlxuICAgICAgICAqIEBwYXJhbSB7b2JqZWN0fHN0cmluZ30gYHVzZXJgIFRoZSBgdXNlcklkYCBvZiB0aGUgdXNlciB0byByZW1vdmUgZnJvbSB0aGUgd29ybGQsIG9yIGFuIG9iamVjdCBjb250YWluaW5nIHRoZSBgdXNlcklkYCBmaWVsZC5cbiAgICAgICAgKiBAcGFyYW0ge29iamVjdH0gYG9wdGlvbnNgIChPcHRpb25hbCkgT3B0aW9ucyBvYmplY3QgdG8gb3ZlcnJpZGUgZ2xvYmFsIG9wdGlvbnMuXG4gICAgICAgICovXG4gICAgICAgIHJlbW92ZVVzZXI6IGZ1bmN0aW9uICh1c2VyLCBvcHRpb25zKSB7XG4gICAgICAgICAgICBvcHRpb25zID0gb3B0aW9ucyB8fCB7fTtcblxuICAgICAgICAgICAgaWYgKHR5cGVvZiB1c2VyID09PSAnc3RyaW5nJykge1xuICAgICAgICAgICAgICAgIHVzZXIgPSB7IHVzZXJJZDogdXNlciB9O1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBpZiAoIXVzZXIudXNlcklkKSB7XG4gICAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdZb3UgbmVlZCB0byBwYXNzIGEgdXNlcklkIHRvIHJlbW92ZSBmcm9tIHRoZSB3b3JsZCcpO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBzZXRJZEZpbHRlck9yVGhyb3dFcnJvcihvcHRpb25zKTtcblxuICAgICAgICAgICAgdmFyIGdldE9wdGlvbnMgPSAkLmV4dGVuZCh0cnVlLCB7fSxcbiAgICAgICAgICAgICAgICBzZXJ2aWNlT3B0aW9ucyxcbiAgICAgICAgICAgICAgICBvcHRpb25zLFxuICAgICAgICAgICAgICAgIHsgdXJsOiB1cmxDb25maWcuZ2V0QVBJUGF0aChhcGlFbmRwb2ludCkgKyBzZXJ2aWNlT3B0aW9ucy5maWx0ZXIgKyAnL3VzZXJzLycgKyB1c2VyLnVzZXJJZCB9XG4gICAgICAgICAgICApO1xuXG4gICAgICAgICAgICByZXR1cm4gaHR0cC5kZWxldGUobnVsbCwgZ2V0T3B0aW9ucyk7XG4gICAgICAgIH0sXG5cbiAgICAgICAgLyoqXG4gICAgICAgICogR2V0cyB0aGUgcnVuIGlkIG9mIGN1cnJlbnQgcnVuIGZvciB0aGUgZ2l2ZW4gd29ybGQuIElmIHRoZSB3b3JsZCBkb2VzIG5vdCBoYXZlIGEgcnVuLCBjcmVhdGVzIGEgbmV3IG9uZSBhbmQgcmV0dXJucyB0aGUgcnVuIGlkLlxuICAgICAgICAqXG4gICAgICAgICogUmVtZW1iZXIgdGhhdCBhIFtydW5dKC4uLy4uL2dsb3NzYXJ5LyNydW4pIGlzIGEgY29sbGVjdGlvbiBvZiBpbnRlcmFjdGlvbnMgd2l0aCBhIHByb2plY3QgYW5kIGl0cyBtb2RlbC4gSW4gdGhlIGNhc2Ugb2YgbXVsdGlwbGF5ZXIgcHJvamVjdHMsIHRoZSBydW4gaXMgc2hhcmVkIGJ5IGFsbCBlbmQgdXNlcnMgaW4gdGhlIHdvcmxkLlxuICAgICAgICAqXG4gICAgICAgICogICoqRXhhbXBsZSoqXG4gICAgICAgICpcbiAgICAgICAgKiAgICAgIHZhciB3YSA9IG5ldyBGLnNlcnZpY2UuV29ybGQoe1xuICAgICAgICAqICAgICAgICAgICBhY2NvdW50OiAnYWNtZS1zaW11bGF0aW9ucycsXG4gICAgICAgICogICAgICAgICAgIHByb2plY3Q6ICdzdXBwbHktY2hhaW4tZ2FtZScsXG4gICAgICAgICogICAgICAgICAgIGdyb3VwOiAndGVhbTEnIH0pO1xuICAgICAgICAqICAgICAgd2EuY3JlYXRlKCk7XG4gICAgICAgICogICAgICAgICAgIC50aGVuKGZ1bmN0aW9uKHdvcmxkKSB7XG4gICAgICAgICogICAgICAgICAgICAgICB3YS5nZXRDdXJyZW50UnVuSWQoeyBtb2RlbDogJ21vZGVsLnB5JyB9KTtcbiAgICAgICAgKiAgICAgICAgICAgfSk7XG4gICAgICAgICpcbiAgICAgICAgKiAqKiBQYXJhbWV0ZXJzICoqXG4gICAgICAgICogQHBhcmFtIHtvYmplY3R9IGBvcHRpb25zYCAoT3B0aW9uYWwpIE9wdGlvbnMgb2JqZWN0IHRvIG92ZXJyaWRlIGdsb2JhbCBvcHRpb25zLlxuICAgICAgICAqIEBwYXJhbSB7b2JqZWN0fSBgb3B0aW9ucy5tb2RlbGAgVGhlIG1vZGVsIGZpbGUgdG8gdXNlIHRvIGNyZWF0ZSBhIHJ1biBpZiBuZWVkZWQuXG4gICAgICAgICovXG4gICAgICAgIGdldEN1cnJlbnRSdW5JZDogZnVuY3Rpb24gKG9wdGlvbnMpIHtcbiAgICAgICAgICAgIG9wdGlvbnMgPSBvcHRpb25zIHx8IHt9O1xuXG4gICAgICAgICAgICBzZXRJZEZpbHRlck9yVGhyb3dFcnJvcihvcHRpb25zKTtcblxuICAgICAgICAgICAgdmFyIGdldE9wdGlvbnMgPSAkLmV4dGVuZCh0cnVlLCB7fSxcbiAgICAgICAgICAgICAgICBzZXJ2aWNlT3B0aW9ucyxcbiAgICAgICAgICAgICAgICBvcHRpb25zLFxuICAgICAgICAgICAgICAgIHsgdXJsOiB1cmxDb25maWcuZ2V0QVBJUGF0aChhcGlFbmRwb2ludCkgKyBzZXJ2aWNlT3B0aW9ucy5maWx0ZXIgKyAnL3J1bicgfVxuICAgICAgICAgICAgKTtcblxuICAgICAgICAgICAgdmFsaWRhdGVNb2RlbE9yVGhyb3dFcnJvcihnZXRPcHRpb25zKTtcbiAgICAgICAgICAgIHJldHVybiBodHRwLnBvc3QoX3BpY2soZ2V0T3B0aW9ucywgJ21vZGVsJyksIGdldE9wdGlvbnMpO1xuICAgICAgICB9LFxuXG4gICAgICAgIC8qKlxuICAgICAgICAqIEdldHMgdGhlIGN1cnJlbnQgKG1vc3QgcmVjZW50KSB3b3JsZCBmb3IgdGhlIGdpdmVuIGVuZCB1c2VyIGluIHRoZSBnaXZlbiBncm91cC4gQnJpbmdzIHRoaXMgbW9zdCByZWNlbnQgd29ybGQgaW50byBtZW1vcnkgaWYgbmVlZGVkLlxuICAgICAgICAqXG4gICAgICAgICogICoqRXhhbXBsZSoqXG4gICAgICAgICpcbiAgICAgICAgKiAgICAgIHZhciB3YSA9IG5ldyBGLnNlcnZpY2UuV29ybGQoe1xuICAgICAgICAqICAgICAgICAgICBhY2NvdW50OiAnYWNtZS1zaW11bGF0aW9ucycsXG4gICAgICAgICogICAgICAgICAgIHByb2plY3Q6ICdzdXBwbHktY2hhaW4tZ2FtZScsXG4gICAgICAgICogICAgICAgICAgIGdyb3VwOiAndGVhbTEnIH0pO1xuICAgICAgICAqICAgICAgd2EuY3JlYXRlKCk7XG4gICAgICAgICogICAgICAgICAgIC50aGVuKGZ1bmN0aW9uKHdvcmxkKSB7XG4gICAgICAgICogICAgICAgICAgICAgICB3YS5nZXRDdXJyZW50V29ybGRGb3JVc2VyKCc4ZjI2MDRjZi05NmNkLTQ0OWYtODJmYS1lMzMxNTMwNzM0ZWUnKTtcbiAgICAgICAgKiAgICAgICAgICAgfSk7XG4gICAgICAgICpcbiAgICAgICAgKiAqKiBQYXJhbWV0ZXJzICoqXG4gICAgICAgICogQHBhcmFtIHtzdHJpbmd9IGB1c2VySWRgIFRoZSBgdXNlcklkYCBvZiB0aGUgdXNlciB3aG9zZSBjdXJyZW50IChtb3N0IHJlY2VudCkgd29ybGQgaXMgYmVpbmcgcmV0cmlldmVkLlxuICAgICAgICAqIEBwYXJhbSB7c3RyaW5nfSBgZ3JvdXBOYW1lYCAoT3B0aW9uYWwpIFRoZSBuYW1lIG9mIHRoZSBncm91cC4gSWYgbm90IHByb3ZpZGVkLCBkZWZhdWx0cyB0byB0aGUgZ3JvdXAgdXNlZCB0byBjcmVhdGUgdGhlIHNlcnZpY2UuXG4gICAgICAgICovXG4gICAgICAgIGdldEN1cnJlbnRXb3JsZEZvclVzZXI6IGZ1bmN0aW9uICh1c2VySWQsIGdyb3VwTmFtZSkge1xuICAgICAgICAgICAgdmFyIGR0ZCA9ICQuRGVmZXJyZWQoKTtcbiAgICAgICAgICAgIHZhciBtZSA9IHRoaXM7XG4gICAgICAgICAgICB0aGlzLmdldFdvcmxkc0ZvclVzZXIodXNlcklkLCB7IGdyb3VwOiBncm91cE5hbWUgfSlcbiAgICAgICAgICAgICAgICAudGhlbihmdW5jdGlvbiAod29ybGRzKSB7XG4gICAgICAgICAgICAgICAgICAgIC8vIGFzc3VtZSB0aGUgbW9zdCByZWNlbnQgd29ybGQgYXMgdGhlICdhY3RpdmUnIHdvcmxkXG4gICAgICAgICAgICAgICAgICAgIHdvcmxkcy5zb3J0KGZ1bmN0aW9uIChhLCBiKSB7IHJldHVybiBuZXcgRGF0ZShiLmxhc3RNb2RpZmllZCkgLSBuZXcgRGF0ZShhLmxhc3RNb2RpZmllZCk7IH0pO1xuICAgICAgICAgICAgICAgICAgICB2YXIgY3VycmVudFdvcmxkID0gd29ybGRzWzBdO1xuXG4gICAgICAgICAgICAgICAgICAgIGlmIChjdXJyZW50V29ybGQpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHNlcnZpY2VPcHRpb25zLmZpbHRlciA9ICBjdXJyZW50V29ybGQuaWQ7XG4gICAgICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgICAgICBkdGQucmVzb2x2ZShjdXJyZW50V29ybGQsIG1lKTtcbiAgICAgICAgICAgICAgICB9KVxuICAgICAgICAgICAgICAgIC5mYWlsKGR0ZC5yZWplY3QpO1xuXG4gICAgICAgICAgICByZXR1cm4gZHRkLnByb21pc2UoKTtcbiAgICAgICAgfSxcblxuICAgICAgICAvKipcbiAgICAgICAgKiBEZWxldGVzIHRoZSBjdXJyZW50IHJ1biBmcm9tIHRoZSB3b3JsZC5cbiAgICAgICAgKlxuICAgICAgICAqICAqKkV4YW1wbGUqKjogVGhpcyBtZXRob2QgaXMgbm90IHlldCBpbXBsZW1lbnRlZC5cbiAgICAgICAgKlxuICAgICAgICAqICAqKlBhcmFtZXRlcnMqKlxuICAgICAgICAqIEBwYXJhbSB7c3RyaW5nfSBgd29ybGRJZGBcbiAgICAgICAgKiBAcGFyYW0ge29iamVjdH0gYG9wdGlvbnNgIChPcHRpb25hbCkgT3B0aW9ucyBvYmplY3QgdG8gb3ZlcnJpZGUgZ2xvYmFsIG9wdGlvbnMuXG4gICAgICAgICovXG4gICAgICAgIGRlbGV0ZVJ1bjogZnVuY3Rpb24gKHdvcmxkSWQsIG9wdGlvbnMpIHtcbiAgICAgICAgICAgIG9wdGlvbnMgPSBvcHRpb25zIHx8IHt9O1xuXG4gICAgICAgICAgICBpZiAod29ybGRJZCkge1xuICAgICAgICAgICAgICAgIG9wdGlvbnMuZmlsdGVyID0gd29ybGRJZDtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgc2V0SWRGaWx0ZXJPclRocm93RXJyb3Iob3B0aW9ucyk7XG5cbiAgICAgICAgICAgIHZhciBkZWxldGVPcHRpb25zID0gJC5leHRlbmQodHJ1ZSwge30sXG4gICAgICAgICAgICAgICAgc2VydmljZU9wdGlvbnMsXG4gICAgICAgICAgICAgICAgb3B0aW9ucyxcbiAgICAgICAgICAgICAgICB7IHVybDogdXJsQ29uZmlnLmdldEFQSVBhdGgoYXBpRW5kcG9pbnQpICsgc2VydmljZU9wdGlvbnMuZmlsdGVyICsgJy9ydW4nIH1cbiAgICAgICAgICAgICk7XG5cbiAgICAgICAgICAgIHJldHVybiBodHRwLmRlbGV0ZShudWxsLCBkZWxldGVPcHRpb25zKTtcbiAgICAgICAgfSxcblxuICAgICAgICAvKipcbiAgICAgICAgKiBDcmVhdGVzIGEgbmV3IHJ1biBmb3IgdGhlIHdvcmxkLlxuICAgICAgICAqXG4gICAgICAgICogICoqRXhhbXBsZSoqOiBUaGlzIG1ldGhvZCBpcyBub3QgeWV0IGltcGxlbWVudGVkLlxuICAgICAgICAqXG4gICAgICAgICogICoqUGFyYW1ldGVycyoqXG4gICAgICAgICogQHBhcmFtIHtzdHJpbmd9IGB3b3JsZElkYCB3b3JsZElkIGluIHdoaWNoIHdlIGNyZWF0ZSB0aGUgbmV3IFJ1bi5cbiAgICAgICAgKiBAcGFyYW0ge29iamVjdH0gYG9wdGlvbnNgIChPcHRpb25hbCkgT3B0aW9ucyBvYmplY3QgdG8gb3ZlcnJpZGUgZ2xvYmFsIG9wdGlvbnMuXG4gICAgICAgICovXG4gICAgICAgIG5ld1J1bkZvcldvcmxkOiBmdW5jdGlvbiAod29ybGRJZCwgb3B0aW9ucykge1xuICAgICAgICAgICAgdmFyIGN1cnJlbnRSdW5PcHRpb25zID0gJC5leHRlbmQodHJ1ZSwge30sXG4gICAgICAgICAgICAgICAgb3B0aW9ucyxcbiAgICAgICAgICAgICAgICB7IGZpbHRlcjogd29ybGRJZCB9XG4gICAgICAgICAgICApO1xuICAgICAgICAgICAgdmFsaWRhdGVNb2RlbE9yVGhyb3dFcnJvcihjdXJyZW50UnVuT3B0aW9ucyk7XG4gICAgICAgICAgICByZXR1cm4gdGhpcy5kZWxldGVSdW4od29ybGRJZCwgb3B0aW9ucylcbiAgICAgICAgICAgICAgICAudGhlbihmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybiB0aGlzLmdldEN1cnJlbnRSdW5JZChjdXJyZW50UnVuT3B0aW9ucyk7XG4gICAgICAgICAgICAgICAgfSk7XG4gICAgICAgIH0sXG5cbiAgICAgICAgLyoqXG4gICAgICAgICogYXV0b0Fzc2lnbiB1c2VycyB0byB3b3JsZHNcbiAgICAgICAgKlxuICAgICAgICAqXG4gICAgICAgICovXG4gICAgICAgIGF1dG9Bc3NpZ246IGZ1bmN0aW9uIChvcHRpb25zKSB7XG4gICAgICAgICAgICBvcHRpb25zID0gb3B0aW9ucyB8fCB7fTtcblxuICAgICAgICAgICAgdmFyIG9wdCA9ICQuZXh0ZW5kKHRydWUsIHt9LFxuICAgICAgICAgICAgICAgIHNlcnZpY2VPcHRpb25zLFxuICAgICAgICAgICAgICAgIG9wdGlvbnMsXG4gICAgICAgICAgICAgICAgeyB1cmw6IHVybENvbmZpZy5nZXRBUElQYXRoKGFzc2lnbm1lbnRFbmRwb2ludCkgfVxuICAgICAgICAgICAgKTtcblxuICAgICAgICAgICAgdmFyIHBhcmFtcyA9IHtcbiAgICAgICAgICAgICAgICBhY2NvdW50OiBvcHQuYWNjb3VudCxcbiAgICAgICAgICAgICAgICBwcm9qZWN0OiBvcHQucHJvamVjdCxcbiAgICAgICAgICAgICAgICBncm91cDogb3B0Lmdyb3VwXG4gICAgICAgICAgICB9O1xuXG4gICAgICAgICAgICBpZiAob3B0Lm1heFVzZXJzKSB7XG4gICAgICAgICAgICAgICAgcGFyYW1zLm1heFVzZXJzID0gb3B0Lm1heFVzZXJzO1xuICAgICAgICB9XG5cbiAgICAgICAgICAgIHJldHVybiBodHRwLnBvc3QocGFyYW1zLCBvcHQpO1xuICAgICAgICB9LFxuXG4gICAgICAgIC8qKlxuICAgICAgICAqIEdldCB0aGUgcHJvamVjdCdzIG11bHRpdXNlciBjb25maWd1cmF0aW9uXG4gICAgICAgICpcbiAgICAgICAgKlxuICAgICAgICAqL1xuICAgICAgICBnZXRQcm9qZWN0U2V0dGluZ3M6IGZ1bmN0aW9uIChvcHRpb25zKSB7XG4gICAgICAgICAgICBvcHRpb25zID0gb3B0aW9ucyB8fCB7fTtcblxuICAgICAgICAgICAgdmFyIG9wdCA9ICQuZXh0ZW5kKHRydWUsIHt9LFxuICAgICAgICAgICAgICAgIHNlcnZpY2VPcHRpb25zLFxuICAgICAgICAgICAgICAgIG9wdGlvbnMsXG4gICAgICAgICAgICAgICAgeyB1cmw6IHVybENvbmZpZy5nZXRBUElQYXRoKHByb2plY3RFbmRwb2ludCkgfVxuICAgICAgICAgICAgKTtcblxuICAgICAgICAgICAgb3B0LnVybCArPSBbb3B0LmFjY291bnQsIG9wdC5wcm9qZWN0XS5qb2luKCcvJyk7XG5cbiAgICAgICAgICAgIHJldHVybiBodHRwLmdldChudWxsLCBvcHQpO1xuICAgICAgICB9XG5cbiAgICB9O1xuXG4gICAgJC5leHRlbmQodGhpcywgcHVibGljQVBJKTtcbn07XG4iLCIvKipcbiAqIEBjbGFzcyBDb29raWUgU3RvcmFnZSBTZXJ2aWNlXG4gKlxuICogQGV4YW1wbGVcbiAqICAgICAgdmFyIHBlb3BsZSA9IHJlcXVpcmUoJ2Nvb2tpZS1zdG9yZScpKHsgcm9vdDogJ3Blb3BsZScgfSk7XG4gICAgICAgIHBlb3BsZVxuICAgICAgICAgICAgLnNhdmUoe2xhc3ROYW1lOiAnc21pdGgnIH0pXG5cbiAqL1xuXG5cbid1c2Ugc3RyaWN0JztcblxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbiAoY29uZmlnKSB7XG4gICAgdmFyIGRlZmF1bHRzID0ge1xuICAgICAgICAvKipcbiAgICAgICAgICogTmFtZSBvZiBjb2xsZWN0aW9uXG4gICAgICAgICAqIEB0eXBlIHsgc3RyaW5nfVxuICAgICAgICAgKi9cbiAgICAgICAgcm9vdDogJy8nLFxuXG4gICAgICAgIGRvbWFpbjogJy5mb3Jpby5jb20nXG4gICAgfTtcbiAgICB2YXIgc2VydmljZU9wdGlvbnMgPSAkLmV4dGVuZCh7fSwgZGVmYXVsdHMsIGNvbmZpZyk7XG5cbiAgICB2YXIgcHVibGljQVBJID0ge1xuICAgICAgICAvLyAqIFRCRFxuICAgICAgICAvLyAgKiBRdWVyeSBjb2xsZWN0aW9uOyB1c2VzIE1vbmdvREIgc3ludGF4XG4gICAgICAgIC8vICAqIEBzZWUgIDxUQkQ6IERhdGEgQVBJIFVSTD5cbiAgICAgICAgLy8gICpcbiAgICAgICAgLy8gICogQHBhcmFtIHsgc3RyaW5nfSBxcyBRdWVyeSBGaWx0ZXJcbiAgICAgICAgLy8gICogQHBhcmFtIHsgc3RyaW5nfSBsaW1pdGVycyBAc2VlIDxUQkQ6IHVybCBmb3IgbGltaXRzLCBwYWdpbmcgZXRjPlxuICAgICAgICAvLyAgKlxuICAgICAgICAvLyAgKiBAZXhhbXBsZVxuICAgICAgICAvLyAgKiAgICAgY3MucXVlcnkoXG4gICAgICAgIC8vICAqICAgICAgeyBuYW1lOiAnSm9obicsIGNsYXNzTmFtZTogJ0NTQzEwMScgfSxcbiAgICAgICAgLy8gICogICAgICB7bGltaXQ6IDEwfVxuICAgICAgICAvLyAgKiAgICAgKVxuXG4gICAgICAgIC8vIHF1ZXJ5OiBmdW5jdGlvbiAocXMsIGxpbWl0ZXJzKSB7XG5cbiAgICAgICAgLy8gfSxcblxuICAgICAgICAvKipcbiAgICAgICAgICogU2F2ZSBjb29raWUgdmFsdWVcbiAgICAgICAgICogQHBhcmFtICB7IHN0cmluZ3xPYmplY3R9IGtleSAgIElmIGdpdmVuIGEga2V5IHNhdmUgdmFsdWVzIHVuZGVyIGl0LCBpZiBnaXZlbiBhbiBvYmplY3QgZGlyZWN0bHksIHNhdmUgdG8gdG9wLWxldmVsIGFwaVxuICAgICAgICAgKiBAcGFyYW0gIHtPYmplY3R9IHZhbHVlIChPcHRpb25hbClcbiAgICAgICAgICogQHBhcmFtIHtPYmplY3R9IG9wdGlvbnMgT3ZlcnJpZGVzIGZvciBzZXJ2aWNlIG9wdGlvbnNcbiAgICAgICAgICpcbiAgICAgICAgICogQHJldHVybiB7Kn0gVGhlIHNhdmVkIHZhbHVlXG4gICAgICAgICAqXG4gICAgICAgICAqIEBleGFtcGxlXG4gICAgICAgICAqICAgICBjcy5zZXQoJ3BlcnNvbicsIHsgZmlyc3ROYW1lOiAnam9obicsIGxhc3ROYW1lOiAnc21pdGgnIH0pO1xuICAgICAgICAgKiAgICAgY3Muc2V0KHsgbmFtZTonc21pdGgnLCBhZ2U6JzMyJyB9KTtcbiAgICAgICAgICovXG4gICAgICAgIHNldDogZnVuY3Rpb24gKGtleSwgdmFsdWUsIG9wdGlvbnMpIHtcbiAgICAgICAgICAgIHZhciBzZXRPcHRpb25zID0gJC5leHRlbmQodHJ1ZSwge30sIHNlcnZpY2VPcHRpb25zLCBvcHRpb25zKTtcblxuICAgICAgICAgICAgdmFyIGRvbWFpbiA9IHNldE9wdGlvbnMuZG9tYWluO1xuICAgICAgICAgICAgdmFyIHBhdGggPSBzZXRPcHRpb25zLnJvb3Q7XG5cbiAgICAgICAgICAgIGRvY3VtZW50LmNvb2tpZSA9IGVuY29kZVVSSUNvbXBvbmVudChrZXkpICsgJz0nICtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgZW5jb2RlVVJJQ29tcG9uZW50KHZhbHVlKSArXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIChkb21haW4gPyAnOyBkb21haW49JyArIGRvbWFpbiA6ICcnKSArXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIChwYXRoID8gJzsgcGF0aD0nICsgcGF0aCA6ICcnKTtcblxuICAgICAgICAgICAgcmV0dXJuIHZhbHVlO1xuICAgICAgICB9LFxuXG4gICAgICAgIC8qKlxuICAgICAgICAgKiBMb2FkIGNvb2tpZSB2YWx1ZVxuICAgICAgICAgKiBAcGFyYW0gIHsgc3RyaW5nfE9iamVjdH0ga2V5ICAgSWYgZ2l2ZW4gYSBrZXkgc2F2ZSB2YWx1ZXMgdW5kZXIgaXQsIGlmIGdpdmVuIGFuIG9iamVjdCBkaXJlY3RseSwgc2F2ZSB0byB0b3AtbGV2ZWwgYXBpXG4gICAgICAgICAqIEByZXR1cm4geyp9IFRoZSB2YWx1ZSBzdG9yZWRcbiAgICAgICAgICpcbiAgICAgICAgICogQGV4YW1wbGVcbiAgICAgICAgICogICAgIGNzLmdldCgncGVyc29uJyk7XG4gICAgICAgICAqL1xuICAgICAgICBnZXQ6IGZ1bmN0aW9uIChrZXkpIHtcbiAgICAgICAgICAgIHZhciBjb29raWVSZWcgPSBuZXcgUmVnRXhwKCcoPzooPzpefC4qOylcXFxccyonICsgZW5jb2RlVVJJQ29tcG9uZW50KGtleSkucmVwbGFjZSgvW1xcLVxcLlxcK1xcKl0vZywgJ1xcXFwkJicpICsgJ1xcXFxzKlxcXFw9XFxcXHMqKFteO10qKS4qJCl8Xi4qJCcpO1xuICAgICAgICAgICAgdmFyIHZhbCA9IGRvY3VtZW50LmNvb2tpZS5yZXBsYWNlKGNvb2tpZVJlZywgJyQxJyk7XG4gICAgICAgICAgICB2YWwgPSBkZWNvZGVVUklDb21wb25lbnQodmFsKSB8fCBudWxsO1xuICAgICAgICAgICAgcmV0dXJuIHZhbDtcbiAgICAgICAgfSxcblxuICAgICAgICAvKipcbiAgICAgICAgICogUmVtb3ZlcyBrZXkgZnJvbSBjb2xsZWN0aW9uXG4gICAgICAgICAqIEBwYXJhbSB7IHN0cmluZ30ga2V5IGtleSB0byByZW1vdmVcbiAgICAgICAgICogQHJldHVybiB7IHN0cmluZ30ga2V5IFRoZSBrZXkgcmVtb3ZlZFxuICAgICAgICAgKlxuICAgICAgICAgKiBAZXhhbXBsZVxuICAgICAgICAgKiAgICAgY3MucmVtb3ZlKCdwZXJzb24nKTtcbiAgICAgICAgICovXG4gICAgICAgIHJlbW92ZTogZnVuY3Rpb24gKGtleSwgb3B0aW9ucykge1xuICAgICAgICAgICAgdmFyIHJlbU9wdGlvbnMgPSAkLmV4dGVuZCh0cnVlLCB7fSwgc2VydmljZU9wdGlvbnMsIG9wdGlvbnMpO1xuXG4gICAgICAgICAgICB2YXIgZG9tYWluID0gcmVtT3B0aW9ucy5kb21haW47XG4gICAgICAgICAgICB2YXIgcGF0aCA9IHJlbU9wdGlvbnMucm9vdDtcblxuICAgICAgICAgICAgZG9jdW1lbnQuY29va2llID0gZW5jb2RlVVJJQ29tcG9uZW50KGtleSkgK1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICc9OyBleHBpcmVzPVRodSwgMDEgSmFuIDE5NzAgMDA6MDA6MDAgR01UJyArXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgKGRvbWFpbiA/ICc7IGRvbWFpbj0nICsgZG9tYWluIDogJycpICtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAocGF0aCA/ICc7IHBhdGg9JyArIHBhdGggOiAnJyk7XG4gICAgICAgICAgICByZXR1cm4ga2V5O1xuICAgICAgICB9LFxuXG4gICAgICAgIC8qKlxuICAgICAgICAgKiBSZW1vdmVzIGNvbGxlY3Rpb24gYmVpbmcgcmVmZXJlbmNlZFxuICAgICAgICAgKiBAcmV0dXJuIHsgYXJyYXl9IGtleXMgQWxsIHRoZSBrZXlzIHJlbW92ZWRcbiAgICAgICAgICovXG4gICAgICAgIGRlc3Ryb3k6IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIHZhciBhS2V5cyA9IGRvY3VtZW50LmNvb2tpZS5yZXBsYWNlKC8oKD86XnxcXHMqOylbXlxcPV0rKSg/PTt8JCl8Xlxccyp8XFxzKig/OlxcPVteO10qKT8oPzpcXDF8JCkvZywgJycpLnNwbGl0KC9cXHMqKD86XFw9W147XSopPztcXHMqLyk7XG4gICAgICAgICAgICBmb3IgKHZhciBuSWR4ID0gMDsgbklkeCA8IGFLZXlzLmxlbmd0aDsgbklkeCsrKSB7XG4gICAgICAgICAgICAgICAgdmFyIGNvb2tpZUtleSA9IGRlY29kZVVSSUNvbXBvbmVudChhS2V5c1tuSWR4XSk7XG4gICAgICAgICAgICAgICAgdGhpcy5yZW1vdmUoY29va2llS2V5KTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJldHVybiBhS2V5cztcbiAgICAgICAgfVxuICAgIH07XG5cbiAgICAkLmV4dGVuZCh0aGlzLCBwdWJsaWNBUEkpO1xufTtcbiIsIi8qKlxuICAgIERlY2lkZXMgdHlwZSBvZiBzdG9yZSB0byBwcm92aWRlXG4qL1xuXG4ndXNlIHN0cmljdCc7XG4vLyB2YXIgaXNOb2RlID0gZmFsc2U7IEZJWE1FOiBCcm93c2VyaWZ5L21pbmlmeWlmeSBoYXMgaXNzdWVzIHdpdGggdGhlIG5leHQgbGlua1xuLy8gdmFyIHN0b3JlID0gKGlzTm9kZSkgPyByZXF1aXJlKCcuL3Nlc3Npb24tc3RvcmUnKSA6IHJlcXVpcmUoJy4vY29va2llLXN0b3JlJyk7XG52YXIgc3RvcmUgPSByZXF1aXJlKCcuL2Nvb2tpZS1zdG9yZScpO1xuXG5tb2R1bGUuZXhwb3J0cyA9IHN0b3JlO1xuIiwiJ3VzZSBzdHJpY3QnO1xuXG52YXIgcXV0aWxzID0gcmVxdWlyZSgnLi4vdXRpbC9xdWVyeS11dGlsJyk7XG5cbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24gKGNvbmZpZykge1xuXG4gICAgdmFyIGRlZmF1bHRzID0ge1xuICAgICAgICB1cmw6ICcnLFxuXG4gICAgICAgIGNvbnRlbnRUeXBlOiAnYXBwbGljYXRpb24vanNvbicsXG4gICAgICAgIGhlYWRlcnM6IHt9LFxuICAgICAgICBzdGF0dXNDb2RlOiB7XG4gICAgICAgICAgICA0MDQ6ICQubm9vcFxuICAgICAgICB9LFxuXG4gICAgICAgIC8qKlxuICAgICAgICAgKiBPTkxZIGZvciBzdHJpbmdzIGluIHRoZSB1cmwuIEFsbCBHRVQgJiBERUxFVEUgcGFyYW1zIGFyZSBydW4gdGhyb3VnaCB0aGlzXG4gICAgICAgICAqIEB0eXBlIHtbdHlwZV0gfVxuICAgICAgICAgKi9cbiAgICAgICAgcGFyYW1ldGVyUGFyc2VyOiBxdXRpbHMudG9RdWVyeUZvcm1hdCxcblxuICAgICAgICAvLyBUbyBhbGxvdyBlcGljZW50ZXIudG9rZW4gYW5kIG90aGVyIHNlc3Npb24gY29va2llcyB0byBiZSBwYXNzZWRcbiAgICAgICAgLy8gd2l0aCB0aGUgcmVxdWVzdHNcbiAgICAgICAgeGhyRmllbGRzOiB7XG4gICAgICAgICAgICB3aXRoQ3JlZGVudGlhbHM6IHRydWVcbiAgICAgICAgfVxuICAgIH07XG5cbiAgICB2YXIgdHJhbnNwb3J0T3B0aW9ucyA9ICQuZXh0ZW5kKHt9LCBkZWZhdWx0cywgY29uZmlnKTtcblxuICAgIHZhciByZXN1bHQgPSBmdW5jdGlvbiAoZCkge1xuICAgICAgICByZXR1cm4gKCQuaXNGdW5jdGlvbihkKSkgPyBkKCkgOiBkO1xuICAgIH07XG5cbiAgICB2YXIgY29ubmVjdCA9IGZ1bmN0aW9uIChtZXRob2QsIHBhcmFtcywgY29ubmVjdE9wdGlvbnMpIHtcbiAgICAgICAgcGFyYW1zID0gcmVzdWx0KHBhcmFtcyk7XG4gICAgICAgIHBhcmFtcyA9ICgkLmlzUGxhaW5PYmplY3QocGFyYW1zKSB8fCAkLmlzQXJyYXkocGFyYW1zKSkgPyBKU09OLnN0cmluZ2lmeShwYXJhbXMpIDogcGFyYW1zO1xuXG4gICAgICAgIHZhciBvcHRpb25zID0gJC5leHRlbmQodHJ1ZSwge30sIHRyYW5zcG9ydE9wdGlvbnMsIGNvbm5lY3RPcHRpb25zLCB7XG4gICAgICAgICAgICB0eXBlOiBtZXRob2QsXG4gICAgICAgICAgICBkYXRhOiBwYXJhbXNcbiAgICAgICAgfSk7XG4gICAgICAgIHZhciBBTExPV0VEX1RPX0JFX0ZVTkNUSU9OUyA9IFsnZGF0YScsICd1cmwnXTtcbiAgICAgICAgJC5lYWNoKG9wdGlvbnMsIGZ1bmN0aW9uIChrZXksIHZhbHVlKSB7XG4gICAgICAgICAgICBpZiAoJC5pc0Z1bmN0aW9uKHZhbHVlKSAmJiAkLmluQXJyYXkoa2V5LCBBTExPV0VEX1RPX0JFX0ZVTkNUSU9OUykgIT09IC0xKSB7XG4gICAgICAgICAgICAgICAgb3B0aW9uc1trZXldID0gdmFsdWUoKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSk7XG5cbiAgICAgICAgaWYgKG9wdGlvbnMubG9nTGV2ZWwgJiYgb3B0aW9ucy5sb2dMZXZlbCA9PT0gJ0RFQlVHJykge1xuICAgICAgICAgICAgY29uc29sZS5sb2cob3B0aW9ucy51cmwpO1xuICAgICAgICAgICAgdmFyIG9sZFN1Y2Nlc3NGbiA9IG9wdGlvbnMuc3VjY2VzcyB8fCAkLm5vb3A7XG4gICAgICAgICAgICBvcHRpb25zLnN1Y2Nlc3MgPSBmdW5jdGlvbiAocmVzcG9uc2UsIGFqYXhTdGF0dXMsIGFqYXhSZXEpIHtcbiAgICAgICAgICAgICAgICBjb25zb2xlLmxvZyhyZXNwb25zZSk7XG4gICAgICAgICAgICAgICAgb2xkU3VjY2Vzc0ZuLmFwcGx5KHRoaXMsIGFyZ3VtZW50cyk7XG4gICAgICAgICAgICB9O1xuICAgICAgICB9XG5cbiAgICAgICAgdmFyIGJlZm9yZVNlbmQgPSBvcHRpb25zLmJlZm9yZVNlbmQ7XG4gICAgICAgIG9wdGlvbnMuYmVmb3JlU2VuZCA9IGZ1bmN0aW9uICh4aHIsIHNldHRpbmdzKSB7XG4gICAgICAgICAgICB4aHIucmVxdWVzdFVybCA9IChjb25uZWN0T3B0aW9ucyB8fCB7fSkudXJsO1xuICAgICAgICAgICAgaWYgKGJlZm9yZVNlbmQpIHtcbiAgICAgICAgICAgICAgICBiZWZvcmVTZW5kLmFwcGx5KHRoaXMsIGFyZ3VtZW50cyk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH07XG5cbiAgICAgICAgcmV0dXJuICQuYWpheChvcHRpb25zKTtcbiAgICB9O1xuXG4gICAgdmFyIHB1YmxpY0FQSSA9IHtcbiAgICAgICAgZ2V0OmZ1bmN0aW9uIChwYXJhbXMsIGFqYXhPcHRpb25zKSB7XG4gICAgICAgICAgICB2YXIgb3B0aW9ucyA9ICQuZXh0ZW5kKHt9LCB0cmFuc3BvcnRPcHRpb25zLCBhamF4T3B0aW9ucyk7XG4gICAgICAgICAgICBwYXJhbXMgPSBvcHRpb25zLnBhcmFtZXRlclBhcnNlcihyZXN1bHQocGFyYW1zKSk7XG4gICAgICAgICAgICByZXR1cm4gY29ubmVjdC5jYWxsKHRoaXMsICdHRVQnLCBwYXJhbXMsIG9wdGlvbnMpO1xuICAgICAgICB9LFxuICAgICAgICBwb3N0OiBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICByZXR1cm4gY29ubmVjdC5hcHBseSh0aGlzLCBbJ3Bvc3QnXS5jb25jYXQoW10uc2xpY2UuY2FsbChhcmd1bWVudHMpKSk7XG4gICAgICAgIH0sXG4gICAgICAgIHBhdGNoOiBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICByZXR1cm4gY29ubmVjdC5hcHBseSh0aGlzLCBbJ3BhdGNoJ10uY29uY2F0KFtdLnNsaWNlLmNhbGwoYXJndW1lbnRzKSkpO1xuICAgICAgICB9LFxuICAgICAgICBwdXQ6IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIHJldHVybiBjb25uZWN0LmFwcGx5KHRoaXMsIFsncHV0J10uY29uY2F0KFtdLnNsaWNlLmNhbGwoYXJndW1lbnRzKSkpO1xuICAgICAgICB9LFxuICAgICAgICBkZWxldGU6IGZ1bmN0aW9uIChwYXJhbXMsIGFqYXhPcHRpb25zKSB7XG4gICAgICAgICAgICAvL0RFTEVURSBkb2Vzbid0IHN1cHBvcnQgYm9keSBwYXJhbXMsIGJ1dCBqUXVlcnkgdGhpbmtzIGl0IGRvZXMuXG4gICAgICAgICAgICB2YXIgb3B0aW9ucyA9ICQuZXh0ZW5kKHt9LCB0cmFuc3BvcnRPcHRpb25zLCBhamF4T3B0aW9ucyk7XG4gICAgICAgICAgICBwYXJhbXMgPSBvcHRpb25zLnBhcmFtZXRlclBhcnNlcihyZXN1bHQocGFyYW1zKSk7XG4gICAgICAgICAgICBpZiAoJC50cmltKHBhcmFtcykpIHtcbiAgICAgICAgICAgICAgICB2YXIgZGVsaW1pdGVyID0gKHJlc3VsdChvcHRpb25zLnVybCkuaW5kZXhPZignPycpID09PSAtMSkgPyAnPycgOiAnJic7XG4gICAgICAgICAgICAgICAgb3B0aW9ucy51cmwgPSByZXN1bHQob3B0aW9ucy51cmwpICsgZGVsaW1pdGVyICsgcGFyYW1zO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgcmV0dXJuIGNvbm5lY3QuY2FsbCh0aGlzLCAnREVMRVRFJywgbnVsbCwgb3B0aW9ucyk7XG4gICAgICAgIH0sXG4gICAgICAgIGhlYWQ6IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIHJldHVybiBjb25uZWN0LmFwcGx5KHRoaXMsIFsnaGVhZCddLmNvbmNhdChbXS5zbGljZS5jYWxsKGFyZ3VtZW50cykpKTtcbiAgICAgICAgfSxcbiAgICAgICAgb3B0aW9uczogZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgcmV0dXJuIGNvbm5lY3QuYXBwbHkodGhpcywgWydvcHRpb25zJ10uY29uY2F0KFtdLnNsaWNlLmNhbGwoYXJndW1lbnRzKSkpO1xuICAgICAgICB9XG4gICAgfTtcblxuICAgIHJldHVybiAkLmV4dGVuZCh0aGlzLCBwdWJsaWNBUEkpO1xufTtcbiIsIid1c2Ugc3RyaWN0JztcblxuLy8gdmFyIGlzTm9kZSA9IGZhbHNlOyBGSVhNRTogQnJvd3NlcmlmeS9taW5pZnlpZnkgaGFzIGlzc3VlcyB3aXRoIHRoZSBuZXh0IGxpbmtcbi8vIHZhciB0cmFuc3BvcnQgPSAoaXNOb2RlKSA/IHJlcXVpcmUoJy4vbm9kZS1odHRwLXRyYW5zcG9ydCcpIDogcmVxdWlyZSgnLi9hamF4LWh0dHAtdHJhbnNwb3J0Jyk7XG52YXIgdHJhbnNwb3J0ID0gcmVxdWlyZSgnLi9hamF4LWh0dHAtdHJhbnNwb3J0Jyk7XG5tb2R1bGUuZXhwb3J0cyA9IHRyYW5zcG9ydDtcbiIsIi8qKlxuLyogSW5oZXJpdCBmcm9tIGEgY2xhc3MgKHVzaW5nIHByb3RvdHlwZSBib3Jyb3dpbmcpXG4qL1xuJ3VzZSBzdHJpY3QnO1xuXG5mdW5jdGlvbiBpbmhlcml0KEMsIFApIHtcbiAgICB2YXIgRiA9IGZ1bmN0aW9uICgpIHt9O1xuICAgIEYucHJvdG90eXBlID0gUC5wcm90b3R5cGU7XG4gICAgQy5wcm90b3R5cGUgPSBuZXcgRigpO1xuICAgIEMuX19zdXBlciA9IFAucHJvdG90eXBlO1xuICAgIEMucHJvdG90eXBlLmNvbnN0cnVjdG9yID0gQztcbn1cblxuLyoqXG4qIFNoYWxsb3cgY29weSBvZiBhbiBvYmplY3RcbiovXG52YXIgZXh0ZW5kID0gZnVuY3Rpb24gKGRlc3QgLyosIHZhcl9hcmdzKi8pIHtcbiAgICB2YXIgb2JqID0gQXJyYXkucHJvdG90eXBlLnNsaWNlLmNhbGwoYXJndW1lbnRzLCAxKTtcbiAgICB2YXIgY3VycmVudDtcbiAgICBmb3IgKHZhciBqID0gMDsgajxvYmoubGVuZ3RoOyBqKyspIHtcbiAgICAgICAgaWYgKCEoY3VycmVudCA9IG9ialtqXSkpIHtcbiAgICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gZG8gbm90IHdyYXAgaW5uZXIgaW4gZGVzdC5oYXNPd25Qcm9wZXJ0eSBvciBiYWQgdGhpbmdzIHdpbGwgaGFwcGVuXG4gICAgICAgIC8qanNoaW50IC1XMDg5ICovXG4gICAgICAgIGZvciAodmFyIGtleSBpbiBjdXJyZW50KSB7XG4gICAgICAgICAgICBkZXN0W2tleV0gPSBjdXJyZW50W2tleV07XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gZGVzdDtcbn07XG5cbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24gKGJhc2UsIHByb3BzLCBzdGF0aWNQcm9wcykge1xuICAgIHZhciBwYXJlbnQgPSBiYXNlO1xuICAgIHZhciBjaGlsZDtcblxuICAgIGNoaWxkID0gcHJvcHMgJiYgcHJvcHMuaGFzT3duUHJvcGVydHkoJ2NvbnN0cnVjdG9yJykgPyBwcm9wcy5jb25zdHJ1Y3RvciA6IGZ1bmN0aW9uICgpIHsgcmV0dXJuIHBhcmVudC5hcHBseSh0aGlzLCBhcmd1bWVudHMpOyB9O1xuXG4gICAgLy8gYWRkIHN0YXRpYyBwcm9wZXJ0aWVzIHRvIHRoZSBjaGlsZCBjb25zdHJ1Y3RvciBmdW5jdGlvblxuICAgIGV4dGVuZChjaGlsZCwgcGFyZW50LCBzdGF0aWNQcm9wcyk7XG5cbiAgICAvLyBhc3NvY2lhdGUgcHJvdG90eXBlIGNoYWluXG4gICAgaW5oZXJpdChjaGlsZCwgcGFyZW50KTtcblxuICAgIC8vIGFkZCBpbnN0YW5jZSBwcm9wZXJ0aWVzXG4gICAgaWYgKHByb3BzKSB7XG4gICAgICAgIGV4dGVuZChjaGlsZC5wcm90b3R5cGUsIHByb3BzKTtcbiAgICB9XG5cbiAgICAvLyBkb25lXG4gICAgcmV0dXJuIGNoaWxkO1xufTtcbiIsIid1c2Ugc3RyaWN0Jztcbi8qanNoaW50IGxvb3BmdW5jOmZhbHNlICovXG5cbmZ1bmN0aW9uIF93KHZhbCkge1xuICAgIGlmICh2YWwgJiYgdmFsLnRoZW4pIHtcbiAgICAgICAgcmV0dXJuIHZhbDtcbiAgICB9XG4gICAgdmFyIHAgPSAkLkRlZmVycmVkKCk7XG4gICAgcC5yZXNvbHZlKHZhbCk7XG5cbiAgICByZXR1cm4gcC5wcm9taXNlKCk7XG59XG5cbmZ1bmN0aW9uIHNlcSgpIHtcbiAgICB2YXIgbGlzdCA9IEFycmF5LnByb3RvdHlwZS5zbGljZS5hcHBseShhcmd1bWVudHMpO1xuXG4gICAgZnVuY3Rpb24gbmV4dChwKSB7XG4gICAgICAgIHZhciBjdXIgPSBsaXN0LnNwbGljZSgwLDEpWzBdO1xuXG4gICAgICAgIGlmICghY3VyKSB7XG4gICAgICAgICAgICByZXR1cm4gcDtcbiAgICAgICAgfVxuXG4gICAgICAgIHJldHVybiBfdyhjdXIocCkpLnRoZW4obmV4dCk7XG4gICAgfVxuXG4gICAgcmV0dXJuIGZ1bmN0aW9uIChzZWVkKSB7XG4gICAgICAgIHJldHVybiBuZXh0KHNlZWQpLmZhaWwoc2VxLmZhaWwpO1xuICAgIH07XG59XG5cbmZ1bmN0aW9uIE1ha2VTZXEob2JqKSB7XG4gICAgdmFyIHJlcyA9IHtcbiAgICAgICAgX19jYWxsczogW10sXG5cbiAgICAgICAgb3JpZ2luYWw6IG9iaixcblxuICAgICAgICB0aGVuOiBmdW5jdGlvbiAoZm4pIHtcbiAgICAgICAgICAgIHRoaXMuX19jYWxscy5wdXNoKGZuKTtcbiAgICAgICAgICAgIHJldHVybiB0aGlzO1xuICAgICAgICB9LFxuXG4gICAgICAgIHN0YXJ0OiBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICB2YXIgX3RoaXMgPSB0aGlzO1xuXG4gICAgICAgICAgICAvLyBjbGVhbiB1cFxuICAgICAgICAgICAgdGhpcy50aGVuKGZ1bmN0aW9uIChydW4pIHtcbiAgICAgICAgICAgICAgICBfdGhpcy5fX2NhbGxzLmxlbmd0aCA9IDA7XG4gICAgICAgICAgICAgICAgcmV0dXJuIHJ1bjtcbiAgICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgICByZXR1cm4gc2VxLmFwcGx5KG51bGwsIHRoaXMuX19jYWxscykoKTtcbiAgICAgICAgfSxcblxuICAgICAgICBmYWlsOiBmdW5jdGlvbiAoZm4pIHtcbiAgICAgICAgICAgIHNlcS5mYWlsID0gZm47XG4gICAgICAgICAgICByZXR1cm4gdGhpcztcbiAgICAgICAgfVxuICAgIH07XG5cbiAgICB2YXIgZnVuY01ha2VyID0gZnVuY3Rpb24gKHAsIG9iaikge1xuICAgICAgICB2YXIgZm4gPSBvYmpbcF0uYmluZChvYmopO1xuICAgICAgICByZXR1cm4gZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgdmFyIGFyZ3MgPSBBcnJheS5wcm90b3R5cGUuc2xpY2UuYXBwbHkoYXJndW1lbnRzKTtcbiAgICAgICAgICAgIHRoaXMuX19jYWxscy5wdXNoKEZ1bmN0aW9uLmJpbmQuYXBwbHkoZm4sIFtudWxsXS5jb25jYXQoYXJncykpKTtcbiAgICAgICAgICAgIHJldHVybiB0aGlzO1xuICAgICAgICB9O1xuICAgIH07XG5cbiAgICBmb3IgKHZhciBwcm9wIGluIG9iaikge1xuICAgICAgICBpZiAodHlwZW9mIG9ialtwcm9wXSA9PT0gJ2Z1bmN0aW9uJykge1xuICAgICAgICAgICAgcmVzW3Byb3BdID0gZnVuY01ha2VyKHByb3AsIG9iaik7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICByZXNbcHJvcF0gPSBvYmpbcHJvcF07XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gcmVzO1xufVxuXG5tb2R1bGUuZXhwb3J0cyA9IE1ha2VTZXE7XG4iLCIndXNlIHN0cmljdCc7XG5cbm1vZHVsZS5leHBvcnRzID0ge1xuICAgIF9waWNrOiBmdW5jdGlvbiAob2JqLCBwcm9wcykge1xuICAgICAgICB2YXIgcmVzID0ge307XG4gICAgICAgIGZvciAodmFyIHAgaW4gb2JqKSB7XG4gICAgICAgICAgICBpZiAocHJvcHMuaW5kZXhPZihwKSAhPT0gLTEpIHtcbiAgICAgICAgICAgICAgICByZXNbcF0gPSBvYmpbcF07XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gcmVzO1xuICAgIH1cbn07XG4iLCIvKipcbiAqIFV0aWxpdGllcyBmb3Igd29ya2luZyB3aXRoIHF1ZXJ5IHN0cmluZ3NcbiovXG4ndXNlIHN0cmljdCc7XG5cbm1vZHVsZS5leHBvcnRzID0gKGZ1bmN0aW9uICgpIHtcblxuICAgIHJldHVybiB7XG4gICAgICAgIC8qKlxuICAgICAgICAgKiBDb252ZXJ0cyB0byBtYXRyaXggZm9ybWF0XG4gICAgICAgICAqIEBwYXJhbSAge09iamVjdH0gcXMgT2JqZWN0IHRvIGNvbnZlcnQgdG8gcXVlcnkgc3RyaW5nXG4gICAgICAgICAqIEByZXR1cm4geyBzdHJpbmd9ICAgIE1hdHJpeC1mb3JtYXQgcXVlcnkgcGFyYW1ldGVyc1xuICAgICAgICAgKi9cbiAgICAgICAgdG9NYXRyaXhGb3JtYXQ6IGZ1bmN0aW9uIChxcykge1xuICAgICAgICAgICAgaWYgKHFzID09PSBudWxsIHx8IHFzID09PSB1bmRlZmluZWQgfHwgcXMgPT09ICcnKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuICc7JztcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlmICh0eXBlb2YgcXMgPT09ICdzdHJpbmcnIHx8IHFzIGluc3RhbmNlb2YgU3RyaW5nKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIHFzO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICB2YXIgcmV0dXJuQXJyYXkgPSBbXTtcbiAgICAgICAgICAgIHZhciBPUEVSQVRPUlMgPSBbJzwnLCAnPicsICchJ107XG4gICAgICAgICAgICAkLmVhY2gocXMsIGZ1bmN0aW9uIChrZXksIHZhbHVlKSB7XG4gICAgICAgICAgICAgICAgaWYgKHR5cGVvZiB2YWx1ZSAhPT0gJ3N0cmluZycgfHwgJC5pbkFycmF5KCQudHJpbSh2YWx1ZSkuY2hhckF0KDApLCBPUEVSQVRPUlMpID09PSAtMSkge1xuICAgICAgICAgICAgICAgICAgICB2YWx1ZSA9ICc9JyArIHZhbHVlO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICByZXR1cm5BcnJheS5wdXNoKGtleSArIHZhbHVlKTtcbiAgICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgICB2YXIgbXRyeCA9ICc7JyArIHJldHVybkFycmF5LmpvaW4oJzsnKTtcbiAgICAgICAgICAgIHJldHVybiBtdHJ4O1xuICAgICAgICB9LFxuXG4gICAgICAgIC8qKlxuICAgICAgICAgKiBDb252ZXJ0cyBzdHJpbmdzL2FycmF5cy9vYmplY3RzIHRvIHR5cGUgJ2E9YiZiPWMnXG4gICAgICAgICAqIEBwYXJhbSAgeyBzdHJpbmd8QXJyYXl8T2JqZWN0fSBxc1xuICAgICAgICAgKiBAcmV0dXJuIHsgc3RyaW5nfVxuICAgICAgICAgKi9cbiAgICAgICAgdG9RdWVyeUZvcm1hdDogZnVuY3Rpb24gKHFzKSB7XG4gICAgICAgICAgICBpZiAocXMgPT09IG51bGwgfHwgcXMgPT09IHVuZGVmaW5lZCkge1xuICAgICAgICAgICAgICAgIHJldHVybiAnJztcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlmICh0eXBlb2YgcXMgPT09ICdzdHJpbmcnIHx8IHFzIGluc3RhbmNlb2YgU3RyaW5nKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIHFzO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICB2YXIgcmV0dXJuQXJyYXkgPSBbXTtcbiAgICAgICAgICAgICQuZWFjaChxcywgZnVuY3Rpb24gKGtleSwgdmFsdWUpIHtcbiAgICAgICAgICAgICAgICBpZiAoJC5pc0FycmF5KHZhbHVlKSkge1xuICAgICAgICAgICAgICAgICAgICB2YWx1ZSA9IHZhbHVlLmpvaW4oJywnKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgaWYgKCQuaXNQbGFpbk9iamVjdCh2YWx1ZSkpIHtcbiAgICAgICAgICAgICAgICAgICAgLy9Nb3N0bHkgZm9yIGRhdGEgYXBpXG4gICAgICAgICAgICAgICAgICAgIHZhbHVlID0gSlNPTi5zdHJpbmdpZnkodmFsdWUpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICByZXR1cm5BcnJheS5wdXNoKGtleSArICc9JyArIHZhbHVlKTtcbiAgICAgICAgICAgIH0pO1xuXG4gICAgICAgICAgICB2YXIgcmVzdWx0ID0gcmV0dXJuQXJyYXkuam9pbignJicpO1xuICAgICAgICAgICAgcmV0dXJuIHJlc3VsdDtcbiAgICAgICAgfSxcblxuICAgICAgICAvKipcbiAgICAgICAgICogQ29udmVydHMgc3RyaW5ncyBvZiB0eXBlICdhPWImYj1jJyB0byB7IGE6YiwgYjpjfVxuICAgICAgICAgKiBAcGFyYW0gIHsgc3RyaW5nfSBxc1xuICAgICAgICAgKiBAcmV0dXJuIHtvYmplY3R9XG4gICAgICAgICAqL1xuICAgICAgICBxc1RvT2JqZWN0OiBmdW5jdGlvbiAocXMpIHtcbiAgICAgICAgICAgIGlmIChxcyA9PT0gbnVsbCB8fCBxcyA9PT0gdW5kZWZpbmVkIHx8IHFzID09PSAnJykge1xuICAgICAgICAgICAgICAgIHJldHVybiB7fTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgdmFyIHFzQXJyYXkgPSBxcy5zcGxpdCgnJicpO1xuICAgICAgICAgICAgdmFyIHJldHVybk9iaiA9IHt9O1xuICAgICAgICAgICAgJC5lYWNoKHFzQXJyYXksIGZ1bmN0aW9uIChpbmRleCwgdmFsdWUpIHtcbiAgICAgICAgICAgICAgICB2YXIgcUtleSA9IHZhbHVlLnNwbGl0KCc9JylbMF07XG4gICAgICAgICAgICAgICAgdmFyIHFWYWwgPSB2YWx1ZS5zcGxpdCgnPScpWzFdO1xuXG4gICAgICAgICAgICAgICAgaWYgKHFWYWwuaW5kZXhPZignLCcpICE9PSAtMSkge1xuICAgICAgICAgICAgICAgICAgICBxVmFsID0gcVZhbC5zcGxpdCgnLCcpO1xuICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgIHJldHVybk9ialtxS2V5XSA9IHFWYWw7XG4gICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgcmV0dXJuIHJldHVybk9iajtcbiAgICAgICAgfSxcblxuICAgICAgICAvKipcbiAgICAgICAgICogTm9ybWFsaXplcyBhbmQgbWVyZ2VzIHN0cmluZ3Mgb2YgdHlwZSAnYT1iJywgeyBiOmN9IHRvIHsgYTpiLCBiOmN9XG4gICAgICAgICAqIEBwYXJhbSAgeyBzdHJpbmd8QXJyYXl8T2JqZWN0fSBxczFcbiAgICAgICAgICogQHBhcmFtICB7IHN0cmluZ3xBcnJheXxPYmplY3R9IHFzMlxuICAgICAgICAgKiBAcmV0dXJuIHtPYmplY3R9XG4gICAgICAgICAqL1xuICAgICAgICBtZXJnZVFTOiBmdW5jdGlvbiAocXMxLCBxczIpIHtcbiAgICAgICAgICAgIHZhciBvYmoxID0gdGhpcy5xc1RvT2JqZWN0KHRoaXMudG9RdWVyeUZvcm1hdChxczEpKTtcbiAgICAgICAgICAgIHZhciBvYmoyID0gdGhpcy5xc1RvT2JqZWN0KHRoaXMudG9RdWVyeUZvcm1hdChxczIpKTtcbiAgICAgICAgICAgIHJldHVybiAkLmV4dGVuZCh0cnVlLCB7fSwgb2JqMSwgb2JqMik7XG4gICAgICAgIH0sXG5cbiAgICAgICAgYWRkVHJhaWxpbmdTbGFzaDogZnVuY3Rpb24gKHVybCkge1xuICAgICAgICAgICAgaWYgKCF1cmwpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gJyc7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICByZXR1cm4gKHVybC5jaGFyQXQodXJsLmxlbmd0aCAtIDEpID09PSAnLycpID8gdXJsIDogKHVybCArICcvJyk7XG4gICAgICAgIH1cbiAgICB9O1xufSgpKTtcblxuXG5cbiIsIi8qKlxuICogVXRpbGl0aWVzIGZvciB3b3JraW5nIHdpdGggdGhlIHJ1biBzZXJ2aWNlXG4qL1xuJ3VzZSBzdHJpY3QnO1xuXG5tb2R1bGUuZXhwb3J0cyA9IChmdW5jdGlvbiAoKSB7XG4gICAgcmV0dXJuIHtcbiAgICAgICAgLyoqXG4gICAgICAgICAqIHJldHVybnMgb3BlcmF0aW9ucyBvZiB0aGUgZm9ybSBbW29wMSxvcDJdLCBbYXJnMSwgYXJnMl1dXG4gICAgICAgICAqIEBwYXJhbSAge09iamVjdHxBcnJheXxTdHJpbmd9IG9wZXJhdGlvbnMgb3BlcmF0aW9ucyB0byBwZXJmb3JtXG4gICAgICAgICAqIEBwYXJhbSAgeyBhcnJheX0gYXJ1Z21lbnRzIGZvciBvcGVyYXRpb25cbiAgICAgICAgICogQHJldHVybiB7IHN0cmluZ30gICAgTWF0cml4LWZvcm1hdCBxdWVyeSBwYXJhbWV0ZXJzXG4gICAgICAgICAqL1xuICAgICAgICBub3JtYWxpemVPcGVyYXRpb25zOiBmdW5jdGlvbiAob3BlcmF0aW9ucywgYXJncykge1xuICAgICAgICAgICAgaWYgKCFhcmdzKSB7XG4gICAgICAgICAgICAgICAgYXJncyA9IFtdO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgdmFyIHJldHVybkxpc3QgPSB7XG4gICAgICAgICAgICAgICAgb3BzOiBbXSxcbiAgICAgICAgICAgICAgICBhcmdzOiBbXVxuICAgICAgICAgICAgfTtcblxuICAgICAgICAgICAgdmFyIF9jb25jYXQgPSBmdW5jdGlvbiAoYXJyKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIChhcnIgIT09IG51bGwgJiYgYXJyICE9PSB1bmRlZmluZWQpID8gW10uY29uY2F0KGFycikgOiBbXTtcbiAgICAgICAgICAgIH07XG5cbiAgICAgICAgICAgIC8veyBhZGQ6IFsxLDJdLCBzdWJ0cmFjdDogWzIsNF0gfVxuICAgICAgICAgICAgdmFyIF9ub3JtYWxpemVQbGFpbk9iamVjdHMgPSBmdW5jdGlvbiAob3BlcmF0aW9ucywgcmV0dXJuTGlzdCkge1xuICAgICAgICAgICAgICAgIGlmICghcmV0dXJuTGlzdCkge1xuICAgICAgICAgICAgICAgICAgICByZXR1cm5MaXN0ID0geyBvcHM6IFtdLCBhcmdzOiBbXSB9O1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAkLmVhY2gob3BlcmF0aW9ucywgZnVuY3Rpb24gKG9wbiwgYXJnKSB7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybkxpc3Qub3BzLnB1c2gob3BuKTtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuTGlzdC5hcmdzLnB1c2goX2NvbmNhdChhcmcpKTtcbiAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgICByZXR1cm4gcmV0dXJuTGlzdDtcbiAgICAgICAgICAgIH07XG4gICAgICAgICAgICAvL3sgbmFtZTogJ2FkZCcsIHBhcmFtczogWzFdIH1cbiAgICAgICAgICAgIHZhciBfbm9ybWFsaXplU3RydWN0dXJlZE9iamVjdHMgPSBmdW5jdGlvbiAob3BlcmF0aW9uLCByZXR1cm5MaXN0KSB7XG4gICAgICAgICAgICAgICAgaWYgKCFyZXR1cm5MaXN0KSB7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybkxpc3QgPSB7IG9wczogW10sIGFyZ3M6IFtdIH07XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIHJldHVybkxpc3Qub3BzLnB1c2gob3BlcmF0aW9uLm5hbWUpO1xuICAgICAgICAgICAgICAgIHJldHVybkxpc3QuYXJncy5wdXNoKF9jb25jYXQob3BlcmF0aW9uLnBhcmFtcykpO1xuICAgICAgICAgICAgICAgIHJldHVybiByZXR1cm5MaXN0O1xuICAgICAgICAgICAgfTtcblxuICAgICAgICAgICAgdmFyIF9ub3JtYWxpemVPYmplY3QgPSBmdW5jdGlvbiAob3BlcmF0aW9uLCByZXR1cm5MaXN0KSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuICgob3BlcmF0aW9uLm5hbWUpID8gX25vcm1hbGl6ZVN0cnVjdHVyZWRPYmplY3RzIDogX25vcm1hbGl6ZVBsYWluT2JqZWN0cykob3BlcmF0aW9uLCByZXR1cm5MaXN0KTtcbiAgICAgICAgICAgIH07XG5cbiAgICAgICAgICAgIHZhciBfbm9ybWFsaXplTGl0ZXJhbHMgPSBmdW5jdGlvbiAob3BlcmF0aW9uLCBhcmdzLCByZXR1cm5MaXN0KSB7XG4gICAgICAgICAgICAgICAgaWYgKCFyZXR1cm5MaXN0KSB7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybkxpc3QgPSB7IG9wczogW10sIGFyZ3M6IFtdIH07XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIHJldHVybkxpc3Qub3BzLnB1c2gob3BlcmF0aW9uKTtcbiAgICAgICAgICAgICAgICByZXR1cm5MaXN0LmFyZ3MucHVzaChfY29uY2F0KGFyZ3MpKTtcbiAgICAgICAgICAgICAgICByZXR1cm4gcmV0dXJuTGlzdDtcbiAgICAgICAgICAgIH07XG5cblxuICAgICAgICAgICAgdmFyIF9ub3JtYWxpemVBcnJheXMgPSBmdW5jdGlvbiAob3BlcmF0aW9ucywgYXJnLCByZXR1cm5MaXN0KSB7XG4gICAgICAgICAgICAgICAgaWYgKCFyZXR1cm5MaXN0KSB7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybkxpc3QgPSB7IG9wczogW10sIGFyZ3M6IFtdIH07XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICQuZWFjaChvcGVyYXRpb25zLCBmdW5jdGlvbiAoaW5kZXgsIG9wbikge1xuICAgICAgICAgICAgICAgICAgICBpZiAoJC5pc1BsYWluT2JqZWN0KG9wbikpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIF9ub3JtYWxpemVPYmplY3Qob3BuLCByZXR1cm5MaXN0KTtcbiAgICAgICAgICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIF9ub3JtYWxpemVMaXRlcmFscyhvcG4sIGFyZ3NbaW5kZXhdLCByZXR1cm5MaXN0KTtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICAgIHJldHVybiByZXR1cm5MaXN0O1xuICAgICAgICAgICAgfTtcblxuICAgICAgICAgICAgaWYgKCQuaXNQbGFpbk9iamVjdChvcGVyYXRpb25zKSkge1xuICAgICAgICAgICAgICAgIF9ub3JtYWxpemVPYmplY3Qob3BlcmF0aW9ucywgcmV0dXJuTGlzdCk7XG4gICAgICAgICAgICB9IGVsc2UgaWYgKCQuaXNBcnJheShvcGVyYXRpb25zKSkge1xuICAgICAgICAgICAgICAgIF9ub3JtYWxpemVBcnJheXMob3BlcmF0aW9ucywgYXJncywgcmV0dXJuTGlzdCk7XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIF9ub3JtYWxpemVMaXRlcmFscyhvcGVyYXRpb25zLCBhcmdzLCByZXR1cm5MaXN0KTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgcmV0dXJuIHJldHVybkxpc3Q7XG4gICAgICAgIH1cbiAgICB9O1xufSgpKTtcbiJdfQ==
