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

var kMaxLength = 0x3fffffff
var rootParent = {}

/**
 * If `Buffer.TYPED_ARRAY_SUPPORT`:
 *   === true    Use Uint8Array implementation (fastest)
 *   === false   Use Object implementation (most compatible, even IE6)
 *
 * Browsers that support typed arrays are IE 10+, Firefox 4+, Chrome 7+, Safari 5.1+,
 * Opera 11.6+, iOS 4.2+.
 *
 * Note:
 *
 * - Implementation must support adding new properties to `Uint8Array` instances.
 *   Firefox 4-29 lacked support, fixed in Firefox 30+.
 *   See: https://bugzilla.mozilla.org/show_bug.cgi?id=695438.
 *
 *  - Chrome 9-10 is missing the `TypedArray.prototype.subarray` function.
 *
 *  - IE10 has a broken `TypedArray.prototype.subarray` function which returns arrays of
 *    incorrect length in some situations.
 *
 * We detect these buggy browsers and set `Buffer.TYPED_ARRAY_SUPPORT` to `false` so they will
 * get the Object implementation, which is slower but will work correctly.
 */
Buffer.TYPED_ARRAY_SUPPORT = (function () {
  try {
    var buf = new ArrayBuffer(0)
    var arr = new Uint8Array(buf)
    arr.foo = function () { return 42 }
    return arr.foo() === 42 && // typed array instances can be augmented
        typeof arr.subarray === 'function' && // chrome 9-10 lack `subarray`
        new Uint8Array(1).subarray(1, 1).byteLength === 0 // ie10 has broken `subarray`
  } catch (e) {
    return false
  }
})()

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
function Buffer (subject, encoding) {
  var self = this
  if (!(self instanceof Buffer)) return new Buffer(subject, encoding)

  var type = typeof subject
  var length

  if (type === 'number') {
    length = +subject
  } else if (type === 'string') {
    length = Buffer.byteLength(subject, encoding)
  } else if (type === 'object' && subject !== null) {
    // assume object is array-like
    if (subject.type === 'Buffer' && isArray(subject.data)) subject = subject.data
    length = +subject.length
  } else {
    throw new TypeError('must start with number, buffer, array or string')
  }

  if (length > kMaxLength) {
    throw new RangeError('Attempt to allocate Buffer larger than maximum size: 0x' +
      kMaxLength.toString(16) + ' bytes')
  }

  if (length < 0) length = 0
  else length >>>= 0 // coerce to uint32

  if (Buffer.TYPED_ARRAY_SUPPORT) {
    // Preferred: Return an augmented `Uint8Array` instance for best performance
    self = Buffer._augment(new Uint8Array(length)) // eslint-disable-line consistent-this
  } else {
    // Fallback: Return THIS instance of Buffer (created by `new`)
    self.length = length
    self._isBuffer = true
  }

  var i
  if (Buffer.TYPED_ARRAY_SUPPORT && typeof subject.byteLength === 'number') {
    // Speed optimization -- use set if we're copying from a typed array
    self._set(subject)
  } else if (isArrayish(subject)) {
    // Treat array-ish objects as a byte array
    if (Buffer.isBuffer(subject)) {
      for (i = 0; i < length; i++) {
        self[i] = subject.readUInt8(i)
      }
    } else {
      for (i = 0; i < length; i++) {
        self[i] = ((subject[i] % 256) + 256) % 256
      }
    }
  } else if (type === 'string') {
    self.write(subject, 0, encoding)
  } else if (type === 'number' && !Buffer.TYPED_ARRAY_SUPPORT) {
    for (i = 0; i < length; i++) {
      self[i] = 0
    }
  }

  if (length > 0 && length <= Buffer.poolSize) self.parent = rootParent

  return self
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
  for (var i = 0, len = Math.min(x, y); i < len && a[i] === b[i]; i++) {}
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

Buffer.concat = function concat (list, totalLength) {
  if (!isArray(list)) throw new TypeError('list argument must be an Array of Buffers.')

  if (list.length === 0) {
    return new Buffer(0)
  } else if (list.length === 1) {
    return list[0]
  }

  var i
  if (totalLength === undefined) {
    totalLength = 0
    for (i = 0; i < list.length; i++) {
      totalLength += list[i].length
    }
  }

  var buf = new Buffer(totalLength)
  var pos = 0
  for (i = 0; i < list.length; i++) {
    var item = list[i]
    item.copy(buf, pos)
    pos += item.length
  }
  return buf
}

Buffer.byteLength = function byteLength (str, encoding) {
  var ret
  str = str + ''
  switch (encoding || 'utf8') {
    case 'ascii':
    case 'binary':
    case 'raw':
      ret = str.length
      break
    case 'ucs2':
    case 'ucs-2':
    case 'utf16le':
    case 'utf-16le':
      ret = str.length * 2
      break
    case 'hex':
      ret = str.length >>> 1
      break
    case 'utf8':
    case 'utf-8':
      ret = utf8ToBytes(str).length
      break
    case 'base64':
      ret = base64ToBytes(str).length
      break
    default:
      ret = str.length
  }
  return ret
}

// pre-set for values that may exist in the future
Buffer.prototype.length = undefined
Buffer.prototype.parent = undefined

// toString(encoding, start=0, end=buffer.length)
Buffer.prototype.toString = function toString (encoding, start, end) {
  var loweredCase = false

  start = start >>> 0
  end = end === undefined || end === Infinity ? this.length : end >>> 0

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

// `get` will be removed in Node 0.13+
Buffer.prototype.get = function get (offset) {
  console.log('.get() is deprecated. Access using array indexes instead.')
  return this.readUInt8(offset)
}

// `set` will be removed in Node 0.13+
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
  var charsWritten = blitBuffer(utf8ToBytes(string, buf.length - offset), buf, offset, length)
  return charsWritten
}

function asciiWrite (buf, string, offset, length) {
  var charsWritten = blitBuffer(asciiToBytes(string), buf, offset, length)
  return charsWritten
}

function binaryWrite (buf, string, offset, length) {
  return asciiWrite(buf, string, offset, length)
}

function base64Write (buf, string, offset, length) {
  var charsWritten = blitBuffer(base64ToBytes(string), buf, offset, length)
  return charsWritten
}

function utf16leWrite (buf, string, offset, length) {
  var charsWritten = blitBuffer(utf16leToBytes(string, buf.length - offset), buf, offset, length)
  return charsWritten
}

Buffer.prototype.write = function write (string, offset, length, encoding) {
  // Support both (string, offset, length, encoding)
  // and the legacy (string, encoding, offset, length)
  if (isFinite(offset)) {
    if (!isFinite(length)) {
      encoding = length
      length = undefined
    }
  } else {  // legacy
    var swap = encoding
    encoding = offset
    offset = length
    length = swap
  }

  offset = Number(offset) || 0

  if (length < 0 || offset < 0 || offset > this.length) {
    throw new RangeError('attempt to write outside buffer bounds')
  }

  var remaining = this.length - offset
  if (!length) {
    length = remaining
  } else {
    length = Number(length)
    if (length > remaining) {
      length = remaining
    }
  }
  encoding = String(encoding || 'utf8').toLowerCase()

  var ret
  switch (encoding) {
    case 'hex':
      ret = hexWrite(this, string, offset, length)
      break
    case 'utf8':
    case 'utf-8':
      ret = utf8Write(this, string, offset, length)
      break
    case 'ascii':
      ret = asciiWrite(this, string, offset, length)
      break
    case 'binary':
      ret = binaryWrite(this, string, offset, length)
      break
    case 'base64':
      ret = base64Write(this, string, offset, length)
      break
    case 'ucs2':
    case 'ucs-2':
    case 'utf16le':
    case 'utf-16le':
      ret = utf16leWrite(this, string, offset, length)
      break
    default:
      throw new TypeError('Unknown encoding: ' + encoding)
  }
  return ret
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
  var res = ''
  var tmp = ''
  end = Math.min(buf.length, end)

  for (var i = start; i < end; i++) {
    if (buf[i] <= 0x7F) {
      res += decodeUtf8Char(tmp) + String.fromCharCode(buf[i])
      tmp = ''
    } else {
      tmp += '%' + buf[i].toString(16)
    }
  }

  return res + decodeUtf8Char(tmp)
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
  offset = offset >>> 0
  byteLength = byteLength >>> 0
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
  offset = offset >>> 0
  byteLength = byteLength >>> 0
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
  offset = offset >>> 0
  byteLength = byteLength >>> 0
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
  offset = offset >>> 0
  byteLength = byteLength >>> 0
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
  offset = offset >>> 0
  byteLength = byteLength >>> 0
  if (!noAssert) checkInt(this, value, offset, byteLength, Math.pow(2, 8 * byteLength), 0)

  var mul = 1
  var i = 0
  this[offset] = value & 0xFF
  while (++i < byteLength && (mul *= 0x100)) {
    this[offset + i] = (value / mul) >>> 0 & 0xFF
  }

  return offset + byteLength
}

Buffer.prototype.writeUIntBE = function writeUIntBE (value, offset, byteLength, noAssert) {
  value = +value
  offset = offset >>> 0
  byteLength = byteLength >>> 0
  if (!noAssert) checkInt(this, value, offset, byteLength, Math.pow(2, 8 * byteLength), 0)

  var i = byteLength - 1
  var mul = 1
  this[offset + i] = value & 0xFF
  while (--i >= 0 && (mul *= 0x100)) {
    this[offset + i] = (value / mul) >>> 0 & 0xFF
  }

  return offset + byteLength
}

Buffer.prototype.writeUInt8 = function writeUInt8 (value, offset, noAssert) {
  value = +value
  offset = offset >>> 0
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
  offset = offset >>> 0
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
  offset = offset >>> 0
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
  offset = offset >>> 0
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
  offset = offset >>> 0
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
  offset = offset >>> 0
  if (!noAssert) {
    checkInt(
      this, value, offset, byteLength,
      Math.pow(2, 8 * byteLength - 1) - 1,
      -Math.pow(2, 8 * byteLength - 1)
    )
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
  offset = offset >>> 0
  if (!noAssert) {
    checkInt(
      this, value, offset, byteLength,
      Math.pow(2, 8 * byteLength - 1) - 1,
      -Math.pow(2, 8 * byteLength - 1)
    )
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
  offset = offset >>> 0
  if (!noAssert) checkInt(this, value, offset, 1, 0x7f, -0x80)
  if (!Buffer.TYPED_ARRAY_SUPPORT) value = Math.floor(value)
  if (value < 0) value = 0xff + value + 1
  this[offset] = value
  return offset + 1
}

Buffer.prototype.writeInt16LE = function writeInt16LE (value, offset, noAssert) {
  value = +value
  offset = offset >>> 0
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
  offset = offset >>> 0
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
  offset = offset >>> 0
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
  offset = offset >>> 0
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
Buffer.prototype.copy = function copy (target, target_start, start, end) {
  if (!start) start = 0
  if (!end && end !== 0) end = this.length
  if (target_start >= target.length) target_start = target.length
  if (!target_start) target_start = 0
  if (end > 0 && end < start) end = start

  // Copy 0 bytes; we're done
  if (end === start) return 0
  if (target.length === 0 || this.length === 0) return 0

  // Fatal error conditions
  if (target_start < 0) {
    throw new RangeError('targetStart out of bounds')
  }
  if (start < 0 || start >= this.length) throw new RangeError('sourceStart out of bounds')
  if (end < 0) throw new RangeError('sourceEnd out of bounds')

  // Are we oob?
  if (end > this.length) end = this.length
  if (target.length - target_start < end - start) {
    end = target.length - target_start + start
  }

  var len = end - start

  if (len < 1000 || !Buffer.TYPED_ARRAY_SUPPORT) {
    for (var i = 0; i < len; i++) {
      target[i + target_start] = this[i + start]
    }
  } else {
    target._set(this.subarray(start, start + len), target_start)
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

  // deprecated, will be removed in node 0.13+
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

var INVALID_BASE64_RE = /[^+\/0-9A-z\-]/g

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

function isArrayish (subject) {
  return isArray(subject) || Buffer.isBuffer(subject) ||
      subject && typeof subject === 'object' &&
      typeof subject.length === 'number'
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
  var i = 0

  for (; i < length; i++) {
    codePoint = string.charCodeAt(i)

    // is surrogate component
    if (codePoint > 0xD7FF && codePoint < 0xE000) {
      // last char was a lead
      if (leadSurrogate) {
        // 2 leads in a row
        if (codePoint < 0xDC00) {
          if ((units -= 3) > -1) bytes.push(0xEF, 0xBF, 0xBD)
          leadSurrogate = codePoint
          continue
        } else {
          // valid surrogate pair
          codePoint = leadSurrogate - 0xD800 << 10 | codePoint - 0xDC00 | 0x10000
          leadSurrogate = null
        }
      } else {
        // no lead yet

        if (codePoint > 0xDBFF) {
          // unexpected trail
          if ((units -= 3) > -1) bytes.push(0xEF, 0xBF, 0xBD)
          continue
        } else if (i + 1 === length) {
          // unpaired lead
          if ((units -= 3) > -1) bytes.push(0xEF, 0xBF, 0xBD)
          continue
        } else {
          // valid lead
          leadSurrogate = codePoint
          continue
        }
      }
    } else if (leadSurrogate) {
      // valid bmp char, but last char was a lead
      if ((units -= 3) > -1) bytes.push(0xEF, 0xBF, 0xBD)
      leadSurrogate = null
    }

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
    } else if (codePoint < 0x200000) {
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

function decodeUtf8Char (str) {
  try {
    return decodeURIComponent(str)
  } catch (err) {
    return String.fromCharCode(0xFFFD) // UTF 8 invalid char
  }
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
exports.read = function(buffer, offset, isLE, mLen, nBytes) {
  var e, m,
      eLen = nBytes * 8 - mLen - 1,
      eMax = (1 << eLen) - 1,
      eBias = eMax >> 1,
      nBits = -7,
      i = isLE ? (nBytes - 1) : 0,
      d = isLE ? -1 : 1,
      s = buffer[offset + i];

  i += d;

  e = s & ((1 << (-nBits)) - 1);
  s >>= (-nBits);
  nBits += eLen;
  for (; nBits > 0; e = e * 256 + buffer[offset + i], i += d, nBits -= 8);

  m = e & ((1 << (-nBits)) - 1);
  e >>= (-nBits);
  nBits += mLen;
  for (; nBits > 0; m = m * 256 + buffer[offset + i], i += d, nBits -= 8);

  if (e === 0) {
    e = 1 - eBias;
  } else if (e === eMax) {
    return m ? NaN : ((s ? -1 : 1) * Infinity);
  } else {
    m = m + Math.pow(2, mLen);
    e = e - eBias;
  }
  return (s ? -1 : 1) * m * Math.pow(2, e - mLen);
};

exports.write = function(buffer, value, offset, isLE, mLen, nBytes) {
  var e, m, c,
      eLen = nBytes * 8 - mLen - 1,
      eMax = (1 << eLen) - 1,
      eBias = eMax >> 1,
      rt = (mLen === 23 ? Math.pow(2, -24) - Math.pow(2, -77) : 0),
      i = isLE ? 0 : (nBytes - 1),
      d = isLE ? 1 : -1,
      s = value < 0 || (value === 0 && 1 / value < 0) ? 1 : 0;

  value = Math.abs(value);

  if (isNaN(value) || value === Infinity) {
    m = isNaN(value) ? 1 : 0;
    e = eMax;
  } else {
    e = Math.floor(Math.log(value) / Math.LN2);
    if (value * (c = Math.pow(2, -e)) < 1) {
      e--;
      c *= 2;
    }
    if (e + eBias >= 1) {
      value += rt / c;
    } else {
      value += rt * Math.pow(2, 1 - eBias);
    }
    if (value * c >= 2) {
      e++;
      c /= 2;
    }

    if (e + eBias >= eMax) {
      m = 0;
      e = eMax;
    } else if (e + eBias >= 1) {
      m = (value * c - 1) * Math.pow(2, mLen);
      e = e + eBias;
    } else {
      m = value * Math.pow(2, eBias - 1) * Math.pow(2, mLen);
      e = 0;
    }
  }

  for (; mLen >= 8; buffer[offset + i] = m & 0xff, i += d, m /= 256, mLen -= 8);

  e = (e << mLen) | m;
  eLen += mLen;
  for (; eLen > 0; buffer[offset + i] = e & 0xff, i += d, e /= 256, eLen -= 8);

  buffer[offset + i - d] |= s * 128;
};

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


},{"./managers/auth-manager":6,"./managers/epicenter-channel-manager":8,"./managers/run-manager":10,"./managers/run-strategies/always-new-strategy":11,"./managers/run-strategies/conditional-creation-strategy":12,"./managers/run-strategies/identity-strategy":13,"./managers/run-strategies/new-if-initialized-strategy":15,"./managers/run-strategies/new-if-missing-strategy":16,"./managers/run-strategies/new-if-persisted-strategy":17,"./managers/scenario-manager":20,"./managers/world-manager":22,"./service/auth-api-service":23,"./service/channel-service":24,"./service/configuration-service":25,"./service/data-api-service":26,"./service/member-api-adapter":27,"./service/run-api-service":28,"./service/state-api-adapter":29,"./service/url-config-service":30,"./service/user-api-adapter":31,"./service/variables-api-service":32,"./service/world-api-adapter":33,"./store/cookie-store":34,"./store/store-factory":35,"./transport/ajax-http-transport":36,"./transport/http-transport-factory":37,"./util/inherit":38,"./util/make-sequence":39,"./util/query-util":41,"./util/run-util":42}],6:[function(require,module,exports){
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

},{"../service/auth-api-service":23,"../service/configuration-service":25,"../service/member-api-adapter":27,"../store/store-factory":35,"./key-names":9,"buffer":1}],7:[function(require,module,exports){
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

},{"../service/channel-service":24}],8:[function(require,module,exports){
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

},{"../service/url-config-service":30,"../util/inherit":38,"./auth-manager":6,"./channel-manager":7}],9:[function(require,module,exports){
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

},{"../service/run-api-service":28,"./run-strategies/strategies-map":19,"./special-operations":21}],11:[function(require,module,exports){
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

},{"../../util/inherit":38,"./conditional-creation-strategy":12}],12:[function(require,module,exports){
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

},{"../../service/url-config-service":30,"../../store/store-factory":35,"../../util/inherit":38,"../../util/make-sequence":39,"../auth-manager":6,"../key-names":9,"./identity-strategy":13}],13:[function(require,module,exports){
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

},{"../../util/inherit":38}],14:[function(require,module,exports){
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

},{"../../service/world-api-adapter":33,"../../util/inherit":38,"../auth-manager":6,"./identity-strategy":13}],15:[function(require,module,exports){
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

},{"../../util/inherit":38,"./conditional-creation-strategy":12}],16:[function(require,module,exports){
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

},{"../../util/inherit":38,"./conditional-creation-strategy":12}],17:[function(require,module,exports){
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

},{"../../util/inherit":38,"./conditional-creation-strategy":12}],18:[function(require,module,exports){
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

},{"../../service/state-api-adapter":29,"../../store/store-factory":35,"../../util/inherit":38,"../key-names":9,"./identity-strategy":13}],19:[function(require,module,exports){
module.exports = {
    'new-if-initialized': require('./new-if-initialized-strategy'),
    'new-if-persisted': require('./new-if-persisted-strategy'),
    'new-if-missing': require('./new-if-missing-strategy'),
    'always-new': require('./always-new-strategy'),
    'multiplayer': require('./multiplayer-strategy'),
    'persistent-single-player': require('./persistent-single-player-strategy'),
    'none': require('./identity-strategy')
};

},{"./always-new-strategy":11,"./identity-strategy":13,"./multiplayer-strategy":14,"./new-if-initialized-strategy":15,"./new-if-missing-strategy":16,"./new-if-persisted-strategy":17,"./persistent-single-player-strategy":18}],20:[function(require,module,exports){
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


},{"../service/run-api-service":28}],21:[function(require,module,exports){
'use strict';


module.exports = {
    reset: function (params, options, manager) {
        return manager.reset(options);
    }
};

},{}],22:[function(require,module,exports){
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

},{"../service/world-api-adapter":33,"./auth-manager":6,"./run-manager":10}],23:[function(require,module,exports){
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

},{"../transport/http-transport-factory":37,"./configuration-service":25}],24:[function(require,module,exports){
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

},{}],25:[function(require,module,exports){
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


},{"./url-config-service":30}],26:[function(require,module,exports){
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

},{"../store/store-factory":35,"../transport/http-transport-factory":37,"../util/query-util":41,"./configuration-service":25}],27:[function(require,module,exports){
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

},{"../transport/http-transport-factory":37,"../util/object-util":40,"./configuration-service":25}],28:[function(require,module,exports){
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


},{"../store/store-factory":35,"../transport/http-transport-factory":37,"../util/object-util":40,"../util/query-util":41,"../util/run-util":42,"./configuration-service":25,"./variables-api-service":32}],29:[function(require,module,exports){
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
},{"../transport/http-transport-factory":37,"../util/object-util":40,"./configuration-service":25}],30:[function(require,module,exports){
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

},{}],31:[function(require,module,exports){
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





},{"../transport/http-transport-factory":37,"../util/query-util":41,"./configuration-service":25}],32:[function(require,module,exports){
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

},{"../transport/http-transport-factory":37}],33:[function(require,module,exports){
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

},{"../store/store-factory":35,"../transport/http-transport-factory":37,"../util/object-util":40,"./configuration-service":25}],34:[function(require,module,exports){
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

},{}],35:[function(require,module,exports){
/**
    Decides type of store to provide
*/

'use strict';
// var isNode = false; FIXME: Browserify/minifyify has issues with the next link
// var store = (isNode) ? require('./session-store') : require('./cookie-store');
var store = require('./cookie-store');

module.exports = store;

},{"./cookie-store":34}],36:[function(require,module,exports){
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

},{"../util/query-util":41}],37:[function(require,module,exports){
'use strict';

// var isNode = false; FIXME: Browserify/minifyify has issues with the next link
// var transport = (isNode) ? require('./node-http-transport') : require('./ajax-http-transport');
var transport = require('./ajax-http-transport');
module.exports = transport;

},{"./ajax-http-transport":36}],38:[function(require,module,exports){
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

},{}],39:[function(require,module,exports){
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

},{}],40:[function(require,module,exports){
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

},{}],41:[function(require,module,exports){
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




},{}],42:[function(require,module,exports){
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIm5vZGVfbW9kdWxlcy9ncnVudC1icm93c2VyaWZ5L25vZGVfbW9kdWxlcy9icm93c2VyaWZ5L25vZGVfbW9kdWxlcy9icm93c2VyLXBhY2svX3ByZWx1ZGUuanMiLCJub2RlX21vZHVsZXMvZ3J1bnQtYnJvd3NlcmlmeS9ub2RlX21vZHVsZXMvYnJvd3NlcmlmeS9ub2RlX21vZHVsZXMvYnVmZmVyL2luZGV4LmpzIiwibm9kZV9tb2R1bGVzL2dydW50LWJyb3dzZXJpZnkvbm9kZV9tb2R1bGVzL2Jyb3dzZXJpZnkvbm9kZV9tb2R1bGVzL2J1ZmZlci9ub2RlX21vZHVsZXMvYmFzZTY0LWpzL2xpYi9iNjQuanMiLCJub2RlX21vZHVsZXMvZ3J1bnQtYnJvd3NlcmlmeS9ub2RlX21vZHVsZXMvYnJvd3NlcmlmeS9ub2RlX21vZHVsZXMvYnVmZmVyL25vZGVfbW9kdWxlcy9pZWVlNzU0L2luZGV4LmpzIiwibm9kZV9tb2R1bGVzL2dydW50LWJyb3dzZXJpZnkvbm9kZV9tb2R1bGVzL2Jyb3dzZXJpZnkvbm9kZV9tb2R1bGVzL2J1ZmZlci9ub2RlX21vZHVsZXMvaXMtYXJyYXkvaW5kZXguanMiLCJzcmMvYXBwLmpzIiwic3JjL21hbmFnZXJzL2F1dGgtbWFuYWdlci5qcyIsInNyYy9tYW5hZ2Vycy9jaGFubmVsLW1hbmFnZXIuanMiLCJzcmMvbWFuYWdlcnMvZXBpY2VudGVyLWNoYW5uZWwtbWFuYWdlci5qcyIsInNyYy9tYW5hZ2Vycy9rZXktbmFtZXMuanMiLCJzcmMvbWFuYWdlcnMvcnVuLW1hbmFnZXIuanMiLCJzcmMvbWFuYWdlcnMvcnVuLXN0cmF0ZWdpZXMvYWx3YXlzLW5ldy1zdHJhdGVneS5qcyIsInNyYy9tYW5hZ2Vycy9ydW4tc3RyYXRlZ2llcy9jb25kaXRpb25hbC1jcmVhdGlvbi1zdHJhdGVneS5qcyIsInNyYy9tYW5hZ2Vycy9ydW4tc3RyYXRlZ2llcy9pZGVudGl0eS1zdHJhdGVneS5qcyIsInNyYy9tYW5hZ2Vycy9ydW4tc3RyYXRlZ2llcy9tdWx0aXBsYXllci1zdHJhdGVneS5qcyIsInNyYy9tYW5hZ2Vycy9ydW4tc3RyYXRlZ2llcy9uZXctaWYtaW5pdGlhbGl6ZWQtc3RyYXRlZ3kuanMiLCJzcmMvbWFuYWdlcnMvcnVuLXN0cmF0ZWdpZXMvbmV3LWlmLW1pc3Npbmctc3RyYXRlZ3kuanMiLCJzcmMvbWFuYWdlcnMvcnVuLXN0cmF0ZWdpZXMvbmV3LWlmLXBlcnNpc3RlZC1zdHJhdGVneS5qcyIsInNyYy9tYW5hZ2Vycy9ydW4tc3RyYXRlZ2llcy9wZXJzaXN0ZW50LXNpbmdsZS1wbGF5ZXItc3RyYXRlZ3kuanMiLCJzcmMvbWFuYWdlcnMvcnVuLXN0cmF0ZWdpZXMvc3RyYXRlZ2llcy1tYXAuanMiLCJzcmMvbWFuYWdlcnMvc2NlbmFyaW8tbWFuYWdlci5qcyIsInNyYy9tYW5hZ2Vycy9zcGVjaWFsLW9wZXJhdGlvbnMuanMiLCJzcmMvbWFuYWdlcnMvd29ybGQtbWFuYWdlci5qcyIsInNyYy9zZXJ2aWNlL2F1dGgtYXBpLXNlcnZpY2UuanMiLCJzcmMvc2VydmljZS9jaGFubmVsLXNlcnZpY2UuanMiLCJzcmMvc2VydmljZS9jb25maWd1cmF0aW9uLXNlcnZpY2UuanMiLCJzcmMvc2VydmljZS9kYXRhLWFwaS1zZXJ2aWNlLmpzIiwic3JjL3NlcnZpY2UvbWVtYmVyLWFwaS1hZGFwdGVyLmpzIiwic3JjL3NlcnZpY2UvcnVuLWFwaS1zZXJ2aWNlLmpzIiwic3JjL3NlcnZpY2Uvc3RhdGUtYXBpLWFkYXB0ZXIuanMiLCJzcmMvc2VydmljZS91cmwtY29uZmlnLXNlcnZpY2UuanMiLCJzcmMvc2VydmljZS91c2VyLWFwaS1hZGFwdGVyLmpzIiwic3JjL3NlcnZpY2UvdmFyaWFibGVzLWFwaS1zZXJ2aWNlLmpzIiwic3JjL3NlcnZpY2Uvd29ybGQtYXBpLWFkYXB0ZXIuanMiLCJzcmMvc3RvcmUvY29va2llLXN0b3JlLmpzIiwic3JjL3N0b3JlL3N0b3JlLWZhY3RvcnkuanMiLCJzcmMvdHJhbnNwb3J0L2FqYXgtaHR0cC10cmFuc3BvcnQuanMiLCJzcmMvdHJhbnNwb3J0L2h0dHAtdHJhbnNwb3J0LWZhY3RvcnkuanMiLCJzcmMvdXRpbC9pbmhlcml0LmpzIiwic3JjL3V0aWwvbWFrZS1zZXF1ZW5jZS5qcyIsInNyYy91dGlsL29iamVjdC11dGlsLmpzIiwic3JjL3V0aWwvcXVlcnktdXRpbC5qcyIsInNyYy91dGlsL3J1bi11dGlsLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBO0FDQUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ256Q0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUM1SEE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDcEZBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ2pDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDM0RBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUM3V0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3ZOQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ2xMQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNOQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUN6SkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNuQkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3hHQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNyQkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUMvRUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ2pCQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDdkJBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNqQkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDMUZBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ1RBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDakRBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNSQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUMzS0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDM0hBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDeExBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3hFQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ2pQQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDOUdBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDamJBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ2pGQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDOURBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ2hHQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3BKQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNyb0JBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDekhBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDVkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3hHQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNOQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUN0REE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDakZBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNkQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ2hIQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQSIsImZpbGUiOiJnZW5lcmF0ZWQuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlc0NvbnRlbnQiOlsiKGZ1bmN0aW9uIGUodCxuLHIpe2Z1bmN0aW9uIHMobyx1KXtpZighbltvXSl7aWYoIXRbb10pe3ZhciBhPXR5cGVvZiByZXF1aXJlPT1cImZ1bmN0aW9uXCImJnJlcXVpcmU7aWYoIXUmJmEpcmV0dXJuIGEobywhMCk7aWYoaSlyZXR1cm4gaShvLCEwKTt2YXIgZj1uZXcgRXJyb3IoXCJDYW5ub3QgZmluZCBtb2R1bGUgJ1wiK28rXCInXCIpO3Rocm93IGYuY29kZT1cIk1PRFVMRV9OT1RfRk9VTkRcIixmfXZhciBsPW5bb109e2V4cG9ydHM6e319O3Rbb11bMF0uY2FsbChsLmV4cG9ydHMsZnVuY3Rpb24oZSl7dmFyIG49dFtvXVsxXVtlXTtyZXR1cm4gcyhuP246ZSl9LGwsbC5leHBvcnRzLGUsdCxuLHIpfXJldHVybiBuW29dLmV4cG9ydHN9dmFyIGk9dHlwZW9mIHJlcXVpcmU9PVwiZnVuY3Rpb25cIiYmcmVxdWlyZTtmb3IodmFyIG89MDtvPHIubGVuZ3RoO28rKylzKHJbb10pO3JldHVybiBzfSkiLCIvKiFcbiAqIFRoZSBidWZmZXIgbW9kdWxlIGZyb20gbm9kZS5qcywgZm9yIHRoZSBicm93c2VyLlxuICpcbiAqIEBhdXRob3IgICBGZXJvc3MgQWJvdWtoYWRpamVoIDxmZXJvc3NAZmVyb3NzLm9yZz4gPGh0dHA6Ly9mZXJvc3Mub3JnPlxuICogQGxpY2Vuc2UgIE1JVFxuICovXG5cbnZhciBiYXNlNjQgPSByZXF1aXJlKCdiYXNlNjQtanMnKVxudmFyIGllZWU3NTQgPSByZXF1aXJlKCdpZWVlNzU0JylcbnZhciBpc0FycmF5ID0gcmVxdWlyZSgnaXMtYXJyYXknKVxuXG5leHBvcnRzLkJ1ZmZlciA9IEJ1ZmZlclxuZXhwb3J0cy5TbG93QnVmZmVyID0gU2xvd0J1ZmZlclxuZXhwb3J0cy5JTlNQRUNUX01BWF9CWVRFUyA9IDUwXG5CdWZmZXIucG9vbFNpemUgPSA4MTkyIC8vIG5vdCB1c2VkIGJ5IHRoaXMgaW1wbGVtZW50YXRpb25cblxudmFyIGtNYXhMZW5ndGggPSAweDNmZmZmZmZmXG52YXIgcm9vdFBhcmVudCA9IHt9XG5cbi8qKlxuICogSWYgYEJ1ZmZlci5UWVBFRF9BUlJBWV9TVVBQT1JUYDpcbiAqICAgPT09IHRydWUgICAgVXNlIFVpbnQ4QXJyYXkgaW1wbGVtZW50YXRpb24gKGZhc3Rlc3QpXG4gKiAgID09PSBmYWxzZSAgIFVzZSBPYmplY3QgaW1wbGVtZW50YXRpb24gKG1vc3QgY29tcGF0aWJsZSwgZXZlbiBJRTYpXG4gKlxuICogQnJvd3NlcnMgdGhhdCBzdXBwb3J0IHR5cGVkIGFycmF5cyBhcmUgSUUgMTArLCBGaXJlZm94IDQrLCBDaHJvbWUgNyssIFNhZmFyaSA1LjErLFxuICogT3BlcmEgMTEuNissIGlPUyA0LjIrLlxuICpcbiAqIE5vdGU6XG4gKlxuICogLSBJbXBsZW1lbnRhdGlvbiBtdXN0IHN1cHBvcnQgYWRkaW5nIG5ldyBwcm9wZXJ0aWVzIHRvIGBVaW50OEFycmF5YCBpbnN0YW5jZXMuXG4gKiAgIEZpcmVmb3ggNC0yOSBsYWNrZWQgc3VwcG9ydCwgZml4ZWQgaW4gRmlyZWZveCAzMCsuXG4gKiAgIFNlZTogaHR0cHM6Ly9idWd6aWxsYS5tb3ppbGxhLm9yZy9zaG93X2J1Zy5jZ2k/aWQ9Njk1NDM4LlxuICpcbiAqICAtIENocm9tZSA5LTEwIGlzIG1pc3NpbmcgdGhlIGBUeXBlZEFycmF5LnByb3RvdHlwZS5zdWJhcnJheWAgZnVuY3Rpb24uXG4gKlxuICogIC0gSUUxMCBoYXMgYSBicm9rZW4gYFR5cGVkQXJyYXkucHJvdG90eXBlLnN1YmFycmF5YCBmdW5jdGlvbiB3aGljaCByZXR1cm5zIGFycmF5cyBvZlxuICogICAgaW5jb3JyZWN0IGxlbmd0aCBpbiBzb21lIHNpdHVhdGlvbnMuXG4gKlxuICogV2UgZGV0ZWN0IHRoZXNlIGJ1Z2d5IGJyb3dzZXJzIGFuZCBzZXQgYEJ1ZmZlci5UWVBFRF9BUlJBWV9TVVBQT1JUYCB0byBgZmFsc2VgIHNvIHRoZXkgd2lsbFxuICogZ2V0IHRoZSBPYmplY3QgaW1wbGVtZW50YXRpb24sIHdoaWNoIGlzIHNsb3dlciBidXQgd2lsbCB3b3JrIGNvcnJlY3RseS5cbiAqL1xuQnVmZmVyLlRZUEVEX0FSUkFZX1NVUFBPUlQgPSAoZnVuY3Rpb24gKCkge1xuICB0cnkge1xuICAgIHZhciBidWYgPSBuZXcgQXJyYXlCdWZmZXIoMClcbiAgICB2YXIgYXJyID0gbmV3IFVpbnQ4QXJyYXkoYnVmKVxuICAgIGFyci5mb28gPSBmdW5jdGlvbiAoKSB7IHJldHVybiA0MiB9XG4gICAgcmV0dXJuIGFyci5mb28oKSA9PT0gNDIgJiYgLy8gdHlwZWQgYXJyYXkgaW5zdGFuY2VzIGNhbiBiZSBhdWdtZW50ZWRcbiAgICAgICAgdHlwZW9mIGFyci5zdWJhcnJheSA9PT0gJ2Z1bmN0aW9uJyAmJiAvLyBjaHJvbWUgOS0xMCBsYWNrIGBzdWJhcnJheWBcbiAgICAgICAgbmV3IFVpbnQ4QXJyYXkoMSkuc3ViYXJyYXkoMSwgMSkuYnl0ZUxlbmd0aCA9PT0gMCAvLyBpZTEwIGhhcyBicm9rZW4gYHN1YmFycmF5YFxuICB9IGNhdGNoIChlKSB7XG4gICAgcmV0dXJuIGZhbHNlXG4gIH1cbn0pKClcblxuLyoqXG4gKiBDbGFzczogQnVmZmVyXG4gKiA9PT09PT09PT09PT09XG4gKlxuICogVGhlIEJ1ZmZlciBjb25zdHJ1Y3RvciByZXR1cm5zIGluc3RhbmNlcyBvZiBgVWludDhBcnJheWAgdGhhdCBhcmUgYXVnbWVudGVkXG4gKiB3aXRoIGZ1bmN0aW9uIHByb3BlcnRpZXMgZm9yIGFsbCB0aGUgbm9kZSBgQnVmZmVyYCBBUEkgZnVuY3Rpb25zLiBXZSB1c2VcbiAqIGBVaW50OEFycmF5YCBzbyB0aGF0IHNxdWFyZSBicmFja2V0IG5vdGF0aW9uIHdvcmtzIGFzIGV4cGVjdGVkIC0tIGl0IHJldHVybnNcbiAqIGEgc2luZ2xlIG9jdGV0LlxuICpcbiAqIEJ5IGF1Z21lbnRpbmcgdGhlIGluc3RhbmNlcywgd2UgY2FuIGF2b2lkIG1vZGlmeWluZyB0aGUgYFVpbnQ4QXJyYXlgXG4gKiBwcm90b3R5cGUuXG4gKi9cbmZ1bmN0aW9uIEJ1ZmZlciAoc3ViamVjdCwgZW5jb2RpbmcpIHtcbiAgdmFyIHNlbGYgPSB0aGlzXG4gIGlmICghKHNlbGYgaW5zdGFuY2VvZiBCdWZmZXIpKSByZXR1cm4gbmV3IEJ1ZmZlcihzdWJqZWN0LCBlbmNvZGluZylcblxuICB2YXIgdHlwZSA9IHR5cGVvZiBzdWJqZWN0XG4gIHZhciBsZW5ndGhcblxuICBpZiAodHlwZSA9PT0gJ251bWJlcicpIHtcbiAgICBsZW5ndGggPSArc3ViamVjdFxuICB9IGVsc2UgaWYgKHR5cGUgPT09ICdzdHJpbmcnKSB7XG4gICAgbGVuZ3RoID0gQnVmZmVyLmJ5dGVMZW5ndGgoc3ViamVjdCwgZW5jb2RpbmcpXG4gIH0gZWxzZSBpZiAodHlwZSA9PT0gJ29iamVjdCcgJiYgc3ViamVjdCAhPT0gbnVsbCkge1xuICAgIC8vIGFzc3VtZSBvYmplY3QgaXMgYXJyYXktbGlrZVxuICAgIGlmIChzdWJqZWN0LnR5cGUgPT09ICdCdWZmZXInICYmIGlzQXJyYXkoc3ViamVjdC5kYXRhKSkgc3ViamVjdCA9IHN1YmplY3QuZGF0YVxuICAgIGxlbmd0aCA9ICtzdWJqZWN0Lmxlbmd0aFxuICB9IGVsc2Uge1xuICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ211c3Qgc3RhcnQgd2l0aCBudW1iZXIsIGJ1ZmZlciwgYXJyYXkgb3Igc3RyaW5nJylcbiAgfVxuXG4gIGlmIChsZW5ndGggPiBrTWF4TGVuZ3RoKSB7XG4gICAgdGhyb3cgbmV3IFJhbmdlRXJyb3IoJ0F0dGVtcHQgdG8gYWxsb2NhdGUgQnVmZmVyIGxhcmdlciB0aGFuIG1heGltdW0gc2l6ZTogMHgnICtcbiAgICAgIGtNYXhMZW5ndGgudG9TdHJpbmcoMTYpICsgJyBieXRlcycpXG4gIH1cblxuICBpZiAobGVuZ3RoIDwgMCkgbGVuZ3RoID0gMFxuICBlbHNlIGxlbmd0aCA+Pj49IDAgLy8gY29lcmNlIHRvIHVpbnQzMlxuXG4gIGlmIChCdWZmZXIuVFlQRURfQVJSQVlfU1VQUE9SVCkge1xuICAgIC8vIFByZWZlcnJlZDogUmV0dXJuIGFuIGF1Z21lbnRlZCBgVWludDhBcnJheWAgaW5zdGFuY2UgZm9yIGJlc3QgcGVyZm9ybWFuY2VcbiAgICBzZWxmID0gQnVmZmVyLl9hdWdtZW50KG5ldyBVaW50OEFycmF5KGxlbmd0aCkpIC8vIGVzbGludC1kaXNhYmxlLWxpbmUgY29uc2lzdGVudC10aGlzXG4gIH0gZWxzZSB7XG4gICAgLy8gRmFsbGJhY2s6IFJldHVybiBUSElTIGluc3RhbmNlIG9mIEJ1ZmZlciAoY3JlYXRlZCBieSBgbmV3YClcbiAgICBzZWxmLmxlbmd0aCA9IGxlbmd0aFxuICAgIHNlbGYuX2lzQnVmZmVyID0gdHJ1ZVxuICB9XG5cbiAgdmFyIGlcbiAgaWYgKEJ1ZmZlci5UWVBFRF9BUlJBWV9TVVBQT1JUICYmIHR5cGVvZiBzdWJqZWN0LmJ5dGVMZW5ndGggPT09ICdudW1iZXInKSB7XG4gICAgLy8gU3BlZWQgb3B0aW1pemF0aW9uIC0tIHVzZSBzZXQgaWYgd2UncmUgY29weWluZyBmcm9tIGEgdHlwZWQgYXJyYXlcbiAgICBzZWxmLl9zZXQoc3ViamVjdClcbiAgfSBlbHNlIGlmIChpc0FycmF5aXNoKHN1YmplY3QpKSB7XG4gICAgLy8gVHJlYXQgYXJyYXktaXNoIG9iamVjdHMgYXMgYSBieXRlIGFycmF5XG4gICAgaWYgKEJ1ZmZlci5pc0J1ZmZlcihzdWJqZWN0KSkge1xuICAgICAgZm9yIChpID0gMDsgaSA8IGxlbmd0aDsgaSsrKSB7XG4gICAgICAgIHNlbGZbaV0gPSBzdWJqZWN0LnJlYWRVSW50OChpKVxuICAgICAgfVxuICAgIH0gZWxzZSB7XG4gICAgICBmb3IgKGkgPSAwOyBpIDwgbGVuZ3RoOyBpKyspIHtcbiAgICAgICAgc2VsZltpXSA9ICgoc3ViamVjdFtpXSAlIDI1NikgKyAyNTYpICUgMjU2XG4gICAgICB9XG4gICAgfVxuICB9IGVsc2UgaWYgKHR5cGUgPT09ICdzdHJpbmcnKSB7XG4gICAgc2VsZi53cml0ZShzdWJqZWN0LCAwLCBlbmNvZGluZylcbiAgfSBlbHNlIGlmICh0eXBlID09PSAnbnVtYmVyJyAmJiAhQnVmZmVyLlRZUEVEX0FSUkFZX1NVUFBPUlQpIHtcbiAgICBmb3IgKGkgPSAwOyBpIDwgbGVuZ3RoOyBpKyspIHtcbiAgICAgIHNlbGZbaV0gPSAwXG4gICAgfVxuICB9XG5cbiAgaWYgKGxlbmd0aCA+IDAgJiYgbGVuZ3RoIDw9IEJ1ZmZlci5wb29sU2l6ZSkgc2VsZi5wYXJlbnQgPSByb290UGFyZW50XG5cbiAgcmV0dXJuIHNlbGZcbn1cblxuZnVuY3Rpb24gU2xvd0J1ZmZlciAoc3ViamVjdCwgZW5jb2RpbmcpIHtcbiAgaWYgKCEodGhpcyBpbnN0YW5jZW9mIFNsb3dCdWZmZXIpKSByZXR1cm4gbmV3IFNsb3dCdWZmZXIoc3ViamVjdCwgZW5jb2RpbmcpXG5cbiAgdmFyIGJ1ZiA9IG5ldyBCdWZmZXIoc3ViamVjdCwgZW5jb2RpbmcpXG4gIGRlbGV0ZSBidWYucGFyZW50XG4gIHJldHVybiBidWZcbn1cblxuQnVmZmVyLmlzQnVmZmVyID0gZnVuY3Rpb24gaXNCdWZmZXIgKGIpIHtcbiAgcmV0dXJuICEhKGIgIT0gbnVsbCAmJiBiLl9pc0J1ZmZlcilcbn1cblxuQnVmZmVyLmNvbXBhcmUgPSBmdW5jdGlvbiBjb21wYXJlIChhLCBiKSB7XG4gIGlmICghQnVmZmVyLmlzQnVmZmVyKGEpIHx8ICFCdWZmZXIuaXNCdWZmZXIoYikpIHtcbiAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdBcmd1bWVudHMgbXVzdCBiZSBCdWZmZXJzJylcbiAgfVxuXG4gIGlmIChhID09PSBiKSByZXR1cm4gMFxuXG4gIHZhciB4ID0gYS5sZW5ndGhcbiAgdmFyIHkgPSBiLmxlbmd0aFxuICBmb3IgKHZhciBpID0gMCwgbGVuID0gTWF0aC5taW4oeCwgeSk7IGkgPCBsZW4gJiYgYVtpXSA9PT0gYltpXTsgaSsrKSB7fVxuICBpZiAoaSAhPT0gbGVuKSB7XG4gICAgeCA9IGFbaV1cbiAgICB5ID0gYltpXVxuICB9XG4gIGlmICh4IDwgeSkgcmV0dXJuIC0xXG4gIGlmICh5IDwgeCkgcmV0dXJuIDFcbiAgcmV0dXJuIDBcbn1cblxuQnVmZmVyLmlzRW5jb2RpbmcgPSBmdW5jdGlvbiBpc0VuY29kaW5nIChlbmNvZGluZykge1xuICBzd2l0Y2ggKFN0cmluZyhlbmNvZGluZykudG9Mb3dlckNhc2UoKSkge1xuICAgIGNhc2UgJ2hleCc6XG4gICAgY2FzZSAndXRmOCc6XG4gICAgY2FzZSAndXRmLTgnOlxuICAgIGNhc2UgJ2FzY2lpJzpcbiAgICBjYXNlICdiaW5hcnknOlxuICAgIGNhc2UgJ2Jhc2U2NCc6XG4gICAgY2FzZSAncmF3JzpcbiAgICBjYXNlICd1Y3MyJzpcbiAgICBjYXNlICd1Y3MtMic6XG4gICAgY2FzZSAndXRmMTZsZSc6XG4gICAgY2FzZSAndXRmLTE2bGUnOlxuICAgICAgcmV0dXJuIHRydWVcbiAgICBkZWZhdWx0OlxuICAgICAgcmV0dXJuIGZhbHNlXG4gIH1cbn1cblxuQnVmZmVyLmNvbmNhdCA9IGZ1bmN0aW9uIGNvbmNhdCAobGlzdCwgdG90YWxMZW5ndGgpIHtcbiAgaWYgKCFpc0FycmF5KGxpc3QpKSB0aHJvdyBuZXcgVHlwZUVycm9yKCdsaXN0IGFyZ3VtZW50IG11c3QgYmUgYW4gQXJyYXkgb2YgQnVmZmVycy4nKVxuXG4gIGlmIChsaXN0Lmxlbmd0aCA9PT0gMCkge1xuICAgIHJldHVybiBuZXcgQnVmZmVyKDApXG4gIH0gZWxzZSBpZiAobGlzdC5sZW5ndGggPT09IDEpIHtcbiAgICByZXR1cm4gbGlzdFswXVxuICB9XG5cbiAgdmFyIGlcbiAgaWYgKHRvdGFsTGVuZ3RoID09PSB1bmRlZmluZWQpIHtcbiAgICB0b3RhbExlbmd0aCA9IDBcbiAgICBmb3IgKGkgPSAwOyBpIDwgbGlzdC5sZW5ndGg7IGkrKykge1xuICAgICAgdG90YWxMZW5ndGggKz0gbGlzdFtpXS5sZW5ndGhcbiAgICB9XG4gIH1cblxuICB2YXIgYnVmID0gbmV3IEJ1ZmZlcih0b3RhbExlbmd0aClcbiAgdmFyIHBvcyA9IDBcbiAgZm9yIChpID0gMDsgaSA8IGxpc3QubGVuZ3RoOyBpKyspIHtcbiAgICB2YXIgaXRlbSA9IGxpc3RbaV1cbiAgICBpdGVtLmNvcHkoYnVmLCBwb3MpXG4gICAgcG9zICs9IGl0ZW0ubGVuZ3RoXG4gIH1cbiAgcmV0dXJuIGJ1ZlxufVxuXG5CdWZmZXIuYnl0ZUxlbmd0aCA9IGZ1bmN0aW9uIGJ5dGVMZW5ndGggKHN0ciwgZW5jb2RpbmcpIHtcbiAgdmFyIHJldFxuICBzdHIgPSBzdHIgKyAnJ1xuICBzd2l0Y2ggKGVuY29kaW5nIHx8ICd1dGY4Jykge1xuICAgIGNhc2UgJ2FzY2lpJzpcbiAgICBjYXNlICdiaW5hcnknOlxuICAgIGNhc2UgJ3Jhdyc6XG4gICAgICByZXQgPSBzdHIubGVuZ3RoXG4gICAgICBicmVha1xuICAgIGNhc2UgJ3VjczInOlxuICAgIGNhc2UgJ3Vjcy0yJzpcbiAgICBjYXNlICd1dGYxNmxlJzpcbiAgICBjYXNlICd1dGYtMTZsZSc6XG4gICAgICByZXQgPSBzdHIubGVuZ3RoICogMlxuICAgICAgYnJlYWtcbiAgICBjYXNlICdoZXgnOlxuICAgICAgcmV0ID0gc3RyLmxlbmd0aCA+Pj4gMVxuICAgICAgYnJlYWtcbiAgICBjYXNlICd1dGY4JzpcbiAgICBjYXNlICd1dGYtOCc6XG4gICAgICByZXQgPSB1dGY4VG9CeXRlcyhzdHIpLmxlbmd0aFxuICAgICAgYnJlYWtcbiAgICBjYXNlICdiYXNlNjQnOlxuICAgICAgcmV0ID0gYmFzZTY0VG9CeXRlcyhzdHIpLmxlbmd0aFxuICAgICAgYnJlYWtcbiAgICBkZWZhdWx0OlxuICAgICAgcmV0ID0gc3RyLmxlbmd0aFxuICB9XG4gIHJldHVybiByZXRcbn1cblxuLy8gcHJlLXNldCBmb3IgdmFsdWVzIHRoYXQgbWF5IGV4aXN0IGluIHRoZSBmdXR1cmVcbkJ1ZmZlci5wcm90b3R5cGUubGVuZ3RoID0gdW5kZWZpbmVkXG5CdWZmZXIucHJvdG90eXBlLnBhcmVudCA9IHVuZGVmaW5lZFxuXG4vLyB0b1N0cmluZyhlbmNvZGluZywgc3RhcnQ9MCwgZW5kPWJ1ZmZlci5sZW5ndGgpXG5CdWZmZXIucHJvdG90eXBlLnRvU3RyaW5nID0gZnVuY3Rpb24gdG9TdHJpbmcgKGVuY29kaW5nLCBzdGFydCwgZW5kKSB7XG4gIHZhciBsb3dlcmVkQ2FzZSA9IGZhbHNlXG5cbiAgc3RhcnQgPSBzdGFydCA+Pj4gMFxuICBlbmQgPSBlbmQgPT09IHVuZGVmaW5lZCB8fCBlbmQgPT09IEluZmluaXR5ID8gdGhpcy5sZW5ndGggOiBlbmQgPj4+IDBcblxuICBpZiAoIWVuY29kaW5nKSBlbmNvZGluZyA9ICd1dGY4J1xuICBpZiAoc3RhcnQgPCAwKSBzdGFydCA9IDBcbiAgaWYgKGVuZCA+IHRoaXMubGVuZ3RoKSBlbmQgPSB0aGlzLmxlbmd0aFxuICBpZiAoZW5kIDw9IHN0YXJ0KSByZXR1cm4gJydcblxuICB3aGlsZSAodHJ1ZSkge1xuICAgIHN3aXRjaCAoZW5jb2RpbmcpIHtcbiAgICAgIGNhc2UgJ2hleCc6XG4gICAgICAgIHJldHVybiBoZXhTbGljZSh0aGlzLCBzdGFydCwgZW5kKVxuXG4gICAgICBjYXNlICd1dGY4JzpcbiAgICAgIGNhc2UgJ3V0Zi04JzpcbiAgICAgICAgcmV0dXJuIHV0ZjhTbGljZSh0aGlzLCBzdGFydCwgZW5kKVxuXG4gICAgICBjYXNlICdhc2NpaSc6XG4gICAgICAgIHJldHVybiBhc2NpaVNsaWNlKHRoaXMsIHN0YXJ0LCBlbmQpXG5cbiAgICAgIGNhc2UgJ2JpbmFyeSc6XG4gICAgICAgIHJldHVybiBiaW5hcnlTbGljZSh0aGlzLCBzdGFydCwgZW5kKVxuXG4gICAgICBjYXNlICdiYXNlNjQnOlxuICAgICAgICByZXR1cm4gYmFzZTY0U2xpY2UodGhpcywgc3RhcnQsIGVuZClcblxuICAgICAgY2FzZSAndWNzMic6XG4gICAgICBjYXNlICd1Y3MtMic6XG4gICAgICBjYXNlICd1dGYxNmxlJzpcbiAgICAgIGNhc2UgJ3V0Zi0xNmxlJzpcbiAgICAgICAgcmV0dXJuIHV0ZjE2bGVTbGljZSh0aGlzLCBzdGFydCwgZW5kKVxuXG4gICAgICBkZWZhdWx0OlxuICAgICAgICBpZiAobG93ZXJlZENhc2UpIHRocm93IG5ldyBUeXBlRXJyb3IoJ1Vua25vd24gZW5jb2Rpbmc6ICcgKyBlbmNvZGluZylcbiAgICAgICAgZW5jb2RpbmcgPSAoZW5jb2RpbmcgKyAnJykudG9Mb3dlckNhc2UoKVxuICAgICAgICBsb3dlcmVkQ2FzZSA9IHRydWVcbiAgICB9XG4gIH1cbn1cblxuQnVmZmVyLnByb3RvdHlwZS5lcXVhbHMgPSBmdW5jdGlvbiBlcXVhbHMgKGIpIHtcbiAgaWYgKCFCdWZmZXIuaXNCdWZmZXIoYikpIHRocm93IG5ldyBUeXBlRXJyb3IoJ0FyZ3VtZW50IG11c3QgYmUgYSBCdWZmZXInKVxuICBpZiAodGhpcyA9PT0gYikgcmV0dXJuIHRydWVcbiAgcmV0dXJuIEJ1ZmZlci5jb21wYXJlKHRoaXMsIGIpID09PSAwXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUuaW5zcGVjdCA9IGZ1bmN0aW9uIGluc3BlY3QgKCkge1xuICB2YXIgc3RyID0gJydcbiAgdmFyIG1heCA9IGV4cG9ydHMuSU5TUEVDVF9NQVhfQllURVNcbiAgaWYgKHRoaXMubGVuZ3RoID4gMCkge1xuICAgIHN0ciA9IHRoaXMudG9TdHJpbmcoJ2hleCcsIDAsIG1heCkubWF0Y2goLy57Mn0vZykuam9pbignICcpXG4gICAgaWYgKHRoaXMubGVuZ3RoID4gbWF4KSBzdHIgKz0gJyAuLi4gJ1xuICB9XG4gIHJldHVybiAnPEJ1ZmZlciAnICsgc3RyICsgJz4nXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUuY29tcGFyZSA9IGZ1bmN0aW9uIGNvbXBhcmUgKGIpIHtcbiAgaWYgKCFCdWZmZXIuaXNCdWZmZXIoYikpIHRocm93IG5ldyBUeXBlRXJyb3IoJ0FyZ3VtZW50IG11c3QgYmUgYSBCdWZmZXInKVxuICBpZiAodGhpcyA9PT0gYikgcmV0dXJuIDBcbiAgcmV0dXJuIEJ1ZmZlci5jb21wYXJlKHRoaXMsIGIpXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUuaW5kZXhPZiA9IGZ1bmN0aW9uIGluZGV4T2YgKHZhbCwgYnl0ZU9mZnNldCkge1xuICBpZiAoYnl0ZU9mZnNldCA+IDB4N2ZmZmZmZmYpIGJ5dGVPZmZzZXQgPSAweDdmZmZmZmZmXG4gIGVsc2UgaWYgKGJ5dGVPZmZzZXQgPCAtMHg4MDAwMDAwMCkgYnl0ZU9mZnNldCA9IC0weDgwMDAwMDAwXG4gIGJ5dGVPZmZzZXQgPj49IDBcblxuICBpZiAodGhpcy5sZW5ndGggPT09IDApIHJldHVybiAtMVxuICBpZiAoYnl0ZU9mZnNldCA+PSB0aGlzLmxlbmd0aCkgcmV0dXJuIC0xXG5cbiAgLy8gTmVnYXRpdmUgb2Zmc2V0cyBzdGFydCBmcm9tIHRoZSBlbmQgb2YgdGhlIGJ1ZmZlclxuICBpZiAoYnl0ZU9mZnNldCA8IDApIGJ5dGVPZmZzZXQgPSBNYXRoLm1heCh0aGlzLmxlbmd0aCArIGJ5dGVPZmZzZXQsIDApXG5cbiAgaWYgKHR5cGVvZiB2YWwgPT09ICdzdHJpbmcnKSB7XG4gICAgaWYgKHZhbC5sZW5ndGggPT09IDApIHJldHVybiAtMSAvLyBzcGVjaWFsIGNhc2U6IGxvb2tpbmcgZm9yIGVtcHR5IHN0cmluZyBhbHdheXMgZmFpbHNcbiAgICByZXR1cm4gU3RyaW5nLnByb3RvdHlwZS5pbmRleE9mLmNhbGwodGhpcywgdmFsLCBieXRlT2Zmc2V0KVxuICB9XG4gIGlmIChCdWZmZXIuaXNCdWZmZXIodmFsKSkge1xuICAgIHJldHVybiBhcnJheUluZGV4T2YodGhpcywgdmFsLCBieXRlT2Zmc2V0KVxuICB9XG4gIGlmICh0eXBlb2YgdmFsID09PSAnbnVtYmVyJykge1xuICAgIGlmIChCdWZmZXIuVFlQRURfQVJSQVlfU1VQUE9SVCAmJiBVaW50OEFycmF5LnByb3RvdHlwZS5pbmRleE9mID09PSAnZnVuY3Rpb24nKSB7XG4gICAgICByZXR1cm4gVWludDhBcnJheS5wcm90b3R5cGUuaW5kZXhPZi5jYWxsKHRoaXMsIHZhbCwgYnl0ZU9mZnNldClcbiAgICB9XG4gICAgcmV0dXJuIGFycmF5SW5kZXhPZih0aGlzLCBbIHZhbCBdLCBieXRlT2Zmc2V0KVxuICB9XG5cbiAgZnVuY3Rpb24gYXJyYXlJbmRleE9mIChhcnIsIHZhbCwgYnl0ZU9mZnNldCkge1xuICAgIHZhciBmb3VuZEluZGV4ID0gLTFcbiAgICBmb3IgKHZhciBpID0gMDsgYnl0ZU9mZnNldCArIGkgPCBhcnIubGVuZ3RoOyBpKyspIHtcbiAgICAgIGlmIChhcnJbYnl0ZU9mZnNldCArIGldID09PSB2YWxbZm91bmRJbmRleCA9PT0gLTEgPyAwIDogaSAtIGZvdW5kSW5kZXhdKSB7XG4gICAgICAgIGlmIChmb3VuZEluZGV4ID09PSAtMSkgZm91bmRJbmRleCA9IGlcbiAgICAgICAgaWYgKGkgLSBmb3VuZEluZGV4ICsgMSA9PT0gdmFsLmxlbmd0aCkgcmV0dXJuIGJ5dGVPZmZzZXQgKyBmb3VuZEluZGV4XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBmb3VuZEluZGV4ID0gLTFcbiAgICAgIH1cbiAgICB9XG4gICAgcmV0dXJuIC0xXG4gIH1cblxuICB0aHJvdyBuZXcgVHlwZUVycm9yKCd2YWwgbXVzdCBiZSBzdHJpbmcsIG51bWJlciBvciBCdWZmZXInKVxufVxuXG4vLyBgZ2V0YCB3aWxsIGJlIHJlbW92ZWQgaW4gTm9kZSAwLjEzK1xuQnVmZmVyLnByb3RvdHlwZS5nZXQgPSBmdW5jdGlvbiBnZXQgKG9mZnNldCkge1xuICBjb25zb2xlLmxvZygnLmdldCgpIGlzIGRlcHJlY2F0ZWQuIEFjY2VzcyB1c2luZyBhcnJheSBpbmRleGVzIGluc3RlYWQuJylcbiAgcmV0dXJuIHRoaXMucmVhZFVJbnQ4KG9mZnNldClcbn1cblxuLy8gYHNldGAgd2lsbCBiZSByZW1vdmVkIGluIE5vZGUgMC4xMytcbkJ1ZmZlci5wcm90b3R5cGUuc2V0ID0gZnVuY3Rpb24gc2V0ICh2LCBvZmZzZXQpIHtcbiAgY29uc29sZS5sb2coJy5zZXQoKSBpcyBkZXByZWNhdGVkLiBBY2Nlc3MgdXNpbmcgYXJyYXkgaW5kZXhlcyBpbnN0ZWFkLicpXG4gIHJldHVybiB0aGlzLndyaXRlVUludDgodiwgb2Zmc2V0KVxufVxuXG5mdW5jdGlvbiBoZXhXcml0ZSAoYnVmLCBzdHJpbmcsIG9mZnNldCwgbGVuZ3RoKSB7XG4gIG9mZnNldCA9IE51bWJlcihvZmZzZXQpIHx8IDBcbiAgdmFyIHJlbWFpbmluZyA9IGJ1Zi5sZW5ndGggLSBvZmZzZXRcbiAgaWYgKCFsZW5ndGgpIHtcbiAgICBsZW5ndGggPSByZW1haW5pbmdcbiAgfSBlbHNlIHtcbiAgICBsZW5ndGggPSBOdW1iZXIobGVuZ3RoKVxuICAgIGlmIChsZW5ndGggPiByZW1haW5pbmcpIHtcbiAgICAgIGxlbmd0aCA9IHJlbWFpbmluZ1xuICAgIH1cbiAgfVxuXG4gIC8vIG11c3QgYmUgYW4gZXZlbiBudW1iZXIgb2YgZGlnaXRzXG4gIHZhciBzdHJMZW4gPSBzdHJpbmcubGVuZ3RoXG4gIGlmIChzdHJMZW4gJSAyICE9PSAwKSB0aHJvdyBuZXcgRXJyb3IoJ0ludmFsaWQgaGV4IHN0cmluZycpXG5cbiAgaWYgKGxlbmd0aCA+IHN0ckxlbiAvIDIpIHtcbiAgICBsZW5ndGggPSBzdHJMZW4gLyAyXG4gIH1cbiAgZm9yICh2YXIgaSA9IDA7IGkgPCBsZW5ndGg7IGkrKykge1xuICAgIHZhciBwYXJzZWQgPSBwYXJzZUludChzdHJpbmcuc3Vic3RyKGkgKiAyLCAyKSwgMTYpXG4gICAgaWYgKGlzTmFOKHBhcnNlZCkpIHRocm93IG5ldyBFcnJvcignSW52YWxpZCBoZXggc3RyaW5nJylcbiAgICBidWZbb2Zmc2V0ICsgaV0gPSBwYXJzZWRcbiAgfVxuICByZXR1cm4gaVxufVxuXG5mdW5jdGlvbiB1dGY4V3JpdGUgKGJ1Ziwgc3RyaW5nLCBvZmZzZXQsIGxlbmd0aCkge1xuICB2YXIgY2hhcnNXcml0dGVuID0gYmxpdEJ1ZmZlcih1dGY4VG9CeXRlcyhzdHJpbmcsIGJ1Zi5sZW5ndGggLSBvZmZzZXQpLCBidWYsIG9mZnNldCwgbGVuZ3RoKVxuICByZXR1cm4gY2hhcnNXcml0dGVuXG59XG5cbmZ1bmN0aW9uIGFzY2lpV3JpdGUgKGJ1Ziwgc3RyaW5nLCBvZmZzZXQsIGxlbmd0aCkge1xuICB2YXIgY2hhcnNXcml0dGVuID0gYmxpdEJ1ZmZlcihhc2NpaVRvQnl0ZXMoc3RyaW5nKSwgYnVmLCBvZmZzZXQsIGxlbmd0aClcbiAgcmV0dXJuIGNoYXJzV3JpdHRlblxufVxuXG5mdW5jdGlvbiBiaW5hcnlXcml0ZSAoYnVmLCBzdHJpbmcsIG9mZnNldCwgbGVuZ3RoKSB7XG4gIHJldHVybiBhc2NpaVdyaXRlKGJ1Ziwgc3RyaW5nLCBvZmZzZXQsIGxlbmd0aClcbn1cblxuZnVuY3Rpb24gYmFzZTY0V3JpdGUgKGJ1Ziwgc3RyaW5nLCBvZmZzZXQsIGxlbmd0aCkge1xuICB2YXIgY2hhcnNXcml0dGVuID0gYmxpdEJ1ZmZlcihiYXNlNjRUb0J5dGVzKHN0cmluZyksIGJ1Ziwgb2Zmc2V0LCBsZW5ndGgpXG4gIHJldHVybiBjaGFyc1dyaXR0ZW5cbn1cblxuZnVuY3Rpb24gdXRmMTZsZVdyaXRlIChidWYsIHN0cmluZywgb2Zmc2V0LCBsZW5ndGgpIHtcbiAgdmFyIGNoYXJzV3JpdHRlbiA9IGJsaXRCdWZmZXIodXRmMTZsZVRvQnl0ZXMoc3RyaW5nLCBidWYubGVuZ3RoIC0gb2Zmc2V0KSwgYnVmLCBvZmZzZXQsIGxlbmd0aClcbiAgcmV0dXJuIGNoYXJzV3JpdHRlblxufVxuXG5CdWZmZXIucHJvdG90eXBlLndyaXRlID0gZnVuY3Rpb24gd3JpdGUgKHN0cmluZywgb2Zmc2V0LCBsZW5ndGgsIGVuY29kaW5nKSB7XG4gIC8vIFN1cHBvcnQgYm90aCAoc3RyaW5nLCBvZmZzZXQsIGxlbmd0aCwgZW5jb2RpbmcpXG4gIC8vIGFuZCB0aGUgbGVnYWN5IChzdHJpbmcsIGVuY29kaW5nLCBvZmZzZXQsIGxlbmd0aClcbiAgaWYgKGlzRmluaXRlKG9mZnNldCkpIHtcbiAgICBpZiAoIWlzRmluaXRlKGxlbmd0aCkpIHtcbiAgICAgIGVuY29kaW5nID0gbGVuZ3RoXG4gICAgICBsZW5ndGggPSB1bmRlZmluZWRcbiAgICB9XG4gIH0gZWxzZSB7ICAvLyBsZWdhY3lcbiAgICB2YXIgc3dhcCA9IGVuY29kaW5nXG4gICAgZW5jb2RpbmcgPSBvZmZzZXRcbiAgICBvZmZzZXQgPSBsZW5ndGhcbiAgICBsZW5ndGggPSBzd2FwXG4gIH1cblxuICBvZmZzZXQgPSBOdW1iZXIob2Zmc2V0KSB8fCAwXG5cbiAgaWYgKGxlbmd0aCA8IDAgfHwgb2Zmc2V0IDwgMCB8fCBvZmZzZXQgPiB0aGlzLmxlbmd0aCkge1xuICAgIHRocm93IG5ldyBSYW5nZUVycm9yKCdhdHRlbXB0IHRvIHdyaXRlIG91dHNpZGUgYnVmZmVyIGJvdW5kcycpXG4gIH1cblxuICB2YXIgcmVtYWluaW5nID0gdGhpcy5sZW5ndGggLSBvZmZzZXRcbiAgaWYgKCFsZW5ndGgpIHtcbiAgICBsZW5ndGggPSByZW1haW5pbmdcbiAgfSBlbHNlIHtcbiAgICBsZW5ndGggPSBOdW1iZXIobGVuZ3RoKVxuICAgIGlmIChsZW5ndGggPiByZW1haW5pbmcpIHtcbiAgICAgIGxlbmd0aCA9IHJlbWFpbmluZ1xuICAgIH1cbiAgfVxuICBlbmNvZGluZyA9IFN0cmluZyhlbmNvZGluZyB8fCAndXRmOCcpLnRvTG93ZXJDYXNlKClcblxuICB2YXIgcmV0XG4gIHN3aXRjaCAoZW5jb2RpbmcpIHtcbiAgICBjYXNlICdoZXgnOlxuICAgICAgcmV0ID0gaGV4V3JpdGUodGhpcywgc3RyaW5nLCBvZmZzZXQsIGxlbmd0aClcbiAgICAgIGJyZWFrXG4gICAgY2FzZSAndXRmOCc6XG4gICAgY2FzZSAndXRmLTgnOlxuICAgICAgcmV0ID0gdXRmOFdyaXRlKHRoaXMsIHN0cmluZywgb2Zmc2V0LCBsZW5ndGgpXG4gICAgICBicmVha1xuICAgIGNhc2UgJ2FzY2lpJzpcbiAgICAgIHJldCA9IGFzY2lpV3JpdGUodGhpcywgc3RyaW5nLCBvZmZzZXQsIGxlbmd0aClcbiAgICAgIGJyZWFrXG4gICAgY2FzZSAnYmluYXJ5JzpcbiAgICAgIHJldCA9IGJpbmFyeVdyaXRlKHRoaXMsIHN0cmluZywgb2Zmc2V0LCBsZW5ndGgpXG4gICAgICBicmVha1xuICAgIGNhc2UgJ2Jhc2U2NCc6XG4gICAgICByZXQgPSBiYXNlNjRXcml0ZSh0aGlzLCBzdHJpbmcsIG9mZnNldCwgbGVuZ3RoKVxuICAgICAgYnJlYWtcbiAgICBjYXNlICd1Y3MyJzpcbiAgICBjYXNlICd1Y3MtMic6XG4gICAgY2FzZSAndXRmMTZsZSc6XG4gICAgY2FzZSAndXRmLTE2bGUnOlxuICAgICAgcmV0ID0gdXRmMTZsZVdyaXRlKHRoaXMsIHN0cmluZywgb2Zmc2V0LCBsZW5ndGgpXG4gICAgICBicmVha1xuICAgIGRlZmF1bHQ6XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdVbmtub3duIGVuY29kaW5nOiAnICsgZW5jb2RpbmcpXG4gIH1cbiAgcmV0dXJuIHJldFxufVxuXG5CdWZmZXIucHJvdG90eXBlLnRvSlNPTiA9IGZ1bmN0aW9uIHRvSlNPTiAoKSB7XG4gIHJldHVybiB7XG4gICAgdHlwZTogJ0J1ZmZlcicsXG4gICAgZGF0YTogQXJyYXkucHJvdG90eXBlLnNsaWNlLmNhbGwodGhpcy5fYXJyIHx8IHRoaXMsIDApXG4gIH1cbn1cblxuZnVuY3Rpb24gYmFzZTY0U2xpY2UgKGJ1Ziwgc3RhcnQsIGVuZCkge1xuICBpZiAoc3RhcnQgPT09IDAgJiYgZW5kID09PSBidWYubGVuZ3RoKSB7XG4gICAgcmV0dXJuIGJhc2U2NC5mcm9tQnl0ZUFycmF5KGJ1ZilcbiAgfSBlbHNlIHtcbiAgICByZXR1cm4gYmFzZTY0LmZyb21CeXRlQXJyYXkoYnVmLnNsaWNlKHN0YXJ0LCBlbmQpKVxuICB9XG59XG5cbmZ1bmN0aW9uIHV0ZjhTbGljZSAoYnVmLCBzdGFydCwgZW5kKSB7XG4gIHZhciByZXMgPSAnJ1xuICB2YXIgdG1wID0gJydcbiAgZW5kID0gTWF0aC5taW4oYnVmLmxlbmd0aCwgZW5kKVxuXG4gIGZvciAodmFyIGkgPSBzdGFydDsgaSA8IGVuZDsgaSsrKSB7XG4gICAgaWYgKGJ1ZltpXSA8PSAweDdGKSB7XG4gICAgICByZXMgKz0gZGVjb2RlVXRmOENoYXIodG1wKSArIFN0cmluZy5mcm9tQ2hhckNvZGUoYnVmW2ldKVxuICAgICAgdG1wID0gJydcbiAgICB9IGVsc2Uge1xuICAgICAgdG1wICs9ICclJyArIGJ1ZltpXS50b1N0cmluZygxNilcbiAgICB9XG4gIH1cblxuICByZXR1cm4gcmVzICsgZGVjb2RlVXRmOENoYXIodG1wKVxufVxuXG5mdW5jdGlvbiBhc2NpaVNsaWNlIChidWYsIHN0YXJ0LCBlbmQpIHtcbiAgdmFyIHJldCA9ICcnXG4gIGVuZCA9IE1hdGgubWluKGJ1Zi5sZW5ndGgsIGVuZClcblxuICBmb3IgKHZhciBpID0gc3RhcnQ7IGkgPCBlbmQ7IGkrKykge1xuICAgIHJldCArPSBTdHJpbmcuZnJvbUNoYXJDb2RlKGJ1ZltpXSAmIDB4N0YpXG4gIH1cbiAgcmV0dXJuIHJldFxufVxuXG5mdW5jdGlvbiBiaW5hcnlTbGljZSAoYnVmLCBzdGFydCwgZW5kKSB7XG4gIHZhciByZXQgPSAnJ1xuICBlbmQgPSBNYXRoLm1pbihidWYubGVuZ3RoLCBlbmQpXG5cbiAgZm9yICh2YXIgaSA9IHN0YXJ0OyBpIDwgZW5kOyBpKyspIHtcbiAgICByZXQgKz0gU3RyaW5nLmZyb21DaGFyQ29kZShidWZbaV0pXG4gIH1cbiAgcmV0dXJuIHJldFxufVxuXG5mdW5jdGlvbiBoZXhTbGljZSAoYnVmLCBzdGFydCwgZW5kKSB7XG4gIHZhciBsZW4gPSBidWYubGVuZ3RoXG5cbiAgaWYgKCFzdGFydCB8fCBzdGFydCA8IDApIHN0YXJ0ID0gMFxuICBpZiAoIWVuZCB8fCBlbmQgPCAwIHx8IGVuZCA+IGxlbikgZW5kID0gbGVuXG5cbiAgdmFyIG91dCA9ICcnXG4gIGZvciAodmFyIGkgPSBzdGFydDsgaSA8IGVuZDsgaSsrKSB7XG4gICAgb3V0ICs9IHRvSGV4KGJ1ZltpXSlcbiAgfVxuICByZXR1cm4gb3V0XG59XG5cbmZ1bmN0aW9uIHV0ZjE2bGVTbGljZSAoYnVmLCBzdGFydCwgZW5kKSB7XG4gIHZhciBieXRlcyA9IGJ1Zi5zbGljZShzdGFydCwgZW5kKVxuICB2YXIgcmVzID0gJydcbiAgZm9yICh2YXIgaSA9IDA7IGkgPCBieXRlcy5sZW5ndGg7IGkgKz0gMikge1xuICAgIHJlcyArPSBTdHJpbmcuZnJvbUNoYXJDb2RlKGJ5dGVzW2ldICsgYnl0ZXNbaSArIDFdICogMjU2KVxuICB9XG4gIHJldHVybiByZXNcbn1cblxuQnVmZmVyLnByb3RvdHlwZS5zbGljZSA9IGZ1bmN0aW9uIHNsaWNlIChzdGFydCwgZW5kKSB7XG4gIHZhciBsZW4gPSB0aGlzLmxlbmd0aFxuICBzdGFydCA9IH5+c3RhcnRcbiAgZW5kID0gZW5kID09PSB1bmRlZmluZWQgPyBsZW4gOiB+fmVuZFxuXG4gIGlmIChzdGFydCA8IDApIHtcbiAgICBzdGFydCArPSBsZW5cbiAgICBpZiAoc3RhcnQgPCAwKSBzdGFydCA9IDBcbiAgfSBlbHNlIGlmIChzdGFydCA+IGxlbikge1xuICAgIHN0YXJ0ID0gbGVuXG4gIH1cblxuICBpZiAoZW5kIDwgMCkge1xuICAgIGVuZCArPSBsZW5cbiAgICBpZiAoZW5kIDwgMCkgZW5kID0gMFxuICB9IGVsc2UgaWYgKGVuZCA+IGxlbikge1xuICAgIGVuZCA9IGxlblxuICB9XG5cbiAgaWYgKGVuZCA8IHN0YXJ0KSBlbmQgPSBzdGFydFxuXG4gIHZhciBuZXdCdWZcbiAgaWYgKEJ1ZmZlci5UWVBFRF9BUlJBWV9TVVBQT1JUKSB7XG4gICAgbmV3QnVmID0gQnVmZmVyLl9hdWdtZW50KHRoaXMuc3ViYXJyYXkoc3RhcnQsIGVuZCkpXG4gIH0gZWxzZSB7XG4gICAgdmFyIHNsaWNlTGVuID0gZW5kIC0gc3RhcnRcbiAgICBuZXdCdWYgPSBuZXcgQnVmZmVyKHNsaWNlTGVuLCB1bmRlZmluZWQpXG4gICAgZm9yICh2YXIgaSA9IDA7IGkgPCBzbGljZUxlbjsgaSsrKSB7XG4gICAgICBuZXdCdWZbaV0gPSB0aGlzW2kgKyBzdGFydF1cbiAgICB9XG4gIH1cblxuICBpZiAobmV3QnVmLmxlbmd0aCkgbmV3QnVmLnBhcmVudCA9IHRoaXMucGFyZW50IHx8IHRoaXNcblxuICByZXR1cm4gbmV3QnVmXG59XG5cbi8qXG4gKiBOZWVkIHRvIG1ha2Ugc3VyZSB0aGF0IGJ1ZmZlciBpc24ndCB0cnlpbmcgdG8gd3JpdGUgb3V0IG9mIGJvdW5kcy5cbiAqL1xuZnVuY3Rpb24gY2hlY2tPZmZzZXQgKG9mZnNldCwgZXh0LCBsZW5ndGgpIHtcbiAgaWYgKChvZmZzZXQgJSAxKSAhPT0gMCB8fCBvZmZzZXQgPCAwKSB0aHJvdyBuZXcgUmFuZ2VFcnJvcignb2Zmc2V0IGlzIG5vdCB1aW50JylcbiAgaWYgKG9mZnNldCArIGV4dCA+IGxlbmd0aCkgdGhyb3cgbmV3IFJhbmdlRXJyb3IoJ1RyeWluZyB0byBhY2Nlc3MgYmV5b25kIGJ1ZmZlciBsZW5ndGgnKVxufVxuXG5CdWZmZXIucHJvdG90eXBlLnJlYWRVSW50TEUgPSBmdW5jdGlvbiByZWFkVUludExFIChvZmZzZXQsIGJ5dGVMZW5ndGgsIG5vQXNzZXJ0KSB7XG4gIG9mZnNldCA9IG9mZnNldCA+Pj4gMFxuICBieXRlTGVuZ3RoID0gYnl0ZUxlbmd0aCA+Pj4gMFxuICBpZiAoIW5vQXNzZXJ0KSBjaGVja09mZnNldChvZmZzZXQsIGJ5dGVMZW5ndGgsIHRoaXMubGVuZ3RoKVxuXG4gIHZhciB2YWwgPSB0aGlzW29mZnNldF1cbiAgdmFyIG11bCA9IDFcbiAgdmFyIGkgPSAwXG4gIHdoaWxlICgrK2kgPCBieXRlTGVuZ3RoICYmIChtdWwgKj0gMHgxMDApKSB7XG4gICAgdmFsICs9IHRoaXNbb2Zmc2V0ICsgaV0gKiBtdWxcbiAgfVxuXG4gIHJldHVybiB2YWxcbn1cblxuQnVmZmVyLnByb3RvdHlwZS5yZWFkVUludEJFID0gZnVuY3Rpb24gcmVhZFVJbnRCRSAob2Zmc2V0LCBieXRlTGVuZ3RoLCBub0Fzc2VydCkge1xuICBvZmZzZXQgPSBvZmZzZXQgPj4+IDBcbiAgYnl0ZUxlbmd0aCA9IGJ5dGVMZW5ndGggPj4+IDBcbiAgaWYgKCFub0Fzc2VydCkge1xuICAgIGNoZWNrT2Zmc2V0KG9mZnNldCwgYnl0ZUxlbmd0aCwgdGhpcy5sZW5ndGgpXG4gIH1cblxuICB2YXIgdmFsID0gdGhpc1tvZmZzZXQgKyAtLWJ5dGVMZW5ndGhdXG4gIHZhciBtdWwgPSAxXG4gIHdoaWxlIChieXRlTGVuZ3RoID4gMCAmJiAobXVsICo9IDB4MTAwKSkge1xuICAgIHZhbCArPSB0aGlzW29mZnNldCArIC0tYnl0ZUxlbmd0aF0gKiBtdWxcbiAgfVxuXG4gIHJldHVybiB2YWxcbn1cblxuQnVmZmVyLnByb3RvdHlwZS5yZWFkVUludDggPSBmdW5jdGlvbiByZWFkVUludDggKG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgaWYgKCFub0Fzc2VydCkgY2hlY2tPZmZzZXQob2Zmc2V0LCAxLCB0aGlzLmxlbmd0aClcbiAgcmV0dXJuIHRoaXNbb2Zmc2V0XVxufVxuXG5CdWZmZXIucHJvdG90eXBlLnJlYWRVSW50MTZMRSA9IGZ1bmN0aW9uIHJlYWRVSW50MTZMRSAob2Zmc2V0LCBub0Fzc2VydCkge1xuICBpZiAoIW5vQXNzZXJ0KSBjaGVja09mZnNldChvZmZzZXQsIDIsIHRoaXMubGVuZ3RoKVxuICByZXR1cm4gdGhpc1tvZmZzZXRdIHwgKHRoaXNbb2Zmc2V0ICsgMV0gPDwgOClcbn1cblxuQnVmZmVyLnByb3RvdHlwZS5yZWFkVUludDE2QkUgPSBmdW5jdGlvbiByZWFkVUludDE2QkUgKG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgaWYgKCFub0Fzc2VydCkgY2hlY2tPZmZzZXQob2Zmc2V0LCAyLCB0aGlzLmxlbmd0aClcbiAgcmV0dXJuICh0aGlzW29mZnNldF0gPDwgOCkgfCB0aGlzW29mZnNldCArIDFdXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUucmVhZFVJbnQzMkxFID0gZnVuY3Rpb24gcmVhZFVJbnQzMkxFIChvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIGlmICghbm9Bc3NlcnQpIGNoZWNrT2Zmc2V0KG9mZnNldCwgNCwgdGhpcy5sZW5ndGgpXG5cbiAgcmV0dXJuICgodGhpc1tvZmZzZXRdKSB8XG4gICAgICAodGhpc1tvZmZzZXQgKyAxXSA8PCA4KSB8XG4gICAgICAodGhpc1tvZmZzZXQgKyAyXSA8PCAxNikpICtcbiAgICAgICh0aGlzW29mZnNldCArIDNdICogMHgxMDAwMDAwKVxufVxuXG5CdWZmZXIucHJvdG90eXBlLnJlYWRVSW50MzJCRSA9IGZ1bmN0aW9uIHJlYWRVSW50MzJCRSAob2Zmc2V0LCBub0Fzc2VydCkge1xuICBpZiAoIW5vQXNzZXJ0KSBjaGVja09mZnNldChvZmZzZXQsIDQsIHRoaXMubGVuZ3RoKVxuXG4gIHJldHVybiAodGhpc1tvZmZzZXRdICogMHgxMDAwMDAwKSArXG4gICAgKCh0aGlzW29mZnNldCArIDFdIDw8IDE2KSB8XG4gICAgKHRoaXNbb2Zmc2V0ICsgMl0gPDwgOCkgfFxuICAgIHRoaXNbb2Zmc2V0ICsgM10pXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUucmVhZEludExFID0gZnVuY3Rpb24gcmVhZEludExFIChvZmZzZXQsIGJ5dGVMZW5ndGgsIG5vQXNzZXJ0KSB7XG4gIG9mZnNldCA9IG9mZnNldCA+Pj4gMFxuICBieXRlTGVuZ3RoID0gYnl0ZUxlbmd0aCA+Pj4gMFxuICBpZiAoIW5vQXNzZXJ0KSBjaGVja09mZnNldChvZmZzZXQsIGJ5dGVMZW5ndGgsIHRoaXMubGVuZ3RoKVxuXG4gIHZhciB2YWwgPSB0aGlzW29mZnNldF1cbiAgdmFyIG11bCA9IDFcbiAgdmFyIGkgPSAwXG4gIHdoaWxlICgrK2kgPCBieXRlTGVuZ3RoICYmIChtdWwgKj0gMHgxMDApKSB7XG4gICAgdmFsICs9IHRoaXNbb2Zmc2V0ICsgaV0gKiBtdWxcbiAgfVxuICBtdWwgKj0gMHg4MFxuXG4gIGlmICh2YWwgPj0gbXVsKSB2YWwgLT0gTWF0aC5wb3coMiwgOCAqIGJ5dGVMZW5ndGgpXG5cbiAgcmV0dXJuIHZhbFxufVxuXG5CdWZmZXIucHJvdG90eXBlLnJlYWRJbnRCRSA9IGZ1bmN0aW9uIHJlYWRJbnRCRSAob2Zmc2V0LCBieXRlTGVuZ3RoLCBub0Fzc2VydCkge1xuICBvZmZzZXQgPSBvZmZzZXQgPj4+IDBcbiAgYnl0ZUxlbmd0aCA9IGJ5dGVMZW5ndGggPj4+IDBcbiAgaWYgKCFub0Fzc2VydCkgY2hlY2tPZmZzZXQob2Zmc2V0LCBieXRlTGVuZ3RoLCB0aGlzLmxlbmd0aClcblxuICB2YXIgaSA9IGJ5dGVMZW5ndGhcbiAgdmFyIG11bCA9IDFcbiAgdmFyIHZhbCA9IHRoaXNbb2Zmc2V0ICsgLS1pXVxuICB3aGlsZSAoaSA+IDAgJiYgKG11bCAqPSAweDEwMCkpIHtcbiAgICB2YWwgKz0gdGhpc1tvZmZzZXQgKyAtLWldICogbXVsXG4gIH1cbiAgbXVsICo9IDB4ODBcblxuICBpZiAodmFsID49IG11bCkgdmFsIC09IE1hdGgucG93KDIsIDggKiBieXRlTGVuZ3RoKVxuXG4gIHJldHVybiB2YWxcbn1cblxuQnVmZmVyLnByb3RvdHlwZS5yZWFkSW50OCA9IGZ1bmN0aW9uIHJlYWRJbnQ4IChvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIGlmICghbm9Bc3NlcnQpIGNoZWNrT2Zmc2V0KG9mZnNldCwgMSwgdGhpcy5sZW5ndGgpXG4gIGlmICghKHRoaXNbb2Zmc2V0XSAmIDB4ODApKSByZXR1cm4gKHRoaXNbb2Zmc2V0XSlcbiAgcmV0dXJuICgoMHhmZiAtIHRoaXNbb2Zmc2V0XSArIDEpICogLTEpXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUucmVhZEludDE2TEUgPSBmdW5jdGlvbiByZWFkSW50MTZMRSAob2Zmc2V0LCBub0Fzc2VydCkge1xuICBpZiAoIW5vQXNzZXJ0KSBjaGVja09mZnNldChvZmZzZXQsIDIsIHRoaXMubGVuZ3RoKVxuICB2YXIgdmFsID0gdGhpc1tvZmZzZXRdIHwgKHRoaXNbb2Zmc2V0ICsgMV0gPDwgOClcbiAgcmV0dXJuICh2YWwgJiAweDgwMDApID8gdmFsIHwgMHhGRkZGMDAwMCA6IHZhbFxufVxuXG5CdWZmZXIucHJvdG90eXBlLnJlYWRJbnQxNkJFID0gZnVuY3Rpb24gcmVhZEludDE2QkUgKG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgaWYgKCFub0Fzc2VydCkgY2hlY2tPZmZzZXQob2Zmc2V0LCAyLCB0aGlzLmxlbmd0aClcbiAgdmFyIHZhbCA9IHRoaXNbb2Zmc2V0ICsgMV0gfCAodGhpc1tvZmZzZXRdIDw8IDgpXG4gIHJldHVybiAodmFsICYgMHg4MDAwKSA/IHZhbCB8IDB4RkZGRjAwMDAgOiB2YWxcbn1cblxuQnVmZmVyLnByb3RvdHlwZS5yZWFkSW50MzJMRSA9IGZ1bmN0aW9uIHJlYWRJbnQzMkxFIChvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIGlmICghbm9Bc3NlcnQpIGNoZWNrT2Zmc2V0KG9mZnNldCwgNCwgdGhpcy5sZW5ndGgpXG5cbiAgcmV0dXJuICh0aGlzW29mZnNldF0pIHxcbiAgICAodGhpc1tvZmZzZXQgKyAxXSA8PCA4KSB8XG4gICAgKHRoaXNbb2Zmc2V0ICsgMl0gPDwgMTYpIHxcbiAgICAodGhpc1tvZmZzZXQgKyAzXSA8PCAyNClcbn1cblxuQnVmZmVyLnByb3RvdHlwZS5yZWFkSW50MzJCRSA9IGZ1bmN0aW9uIHJlYWRJbnQzMkJFIChvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIGlmICghbm9Bc3NlcnQpIGNoZWNrT2Zmc2V0KG9mZnNldCwgNCwgdGhpcy5sZW5ndGgpXG5cbiAgcmV0dXJuICh0aGlzW29mZnNldF0gPDwgMjQpIHxcbiAgICAodGhpc1tvZmZzZXQgKyAxXSA8PCAxNikgfFxuICAgICh0aGlzW29mZnNldCArIDJdIDw8IDgpIHxcbiAgICAodGhpc1tvZmZzZXQgKyAzXSlcbn1cblxuQnVmZmVyLnByb3RvdHlwZS5yZWFkRmxvYXRMRSA9IGZ1bmN0aW9uIHJlYWRGbG9hdExFIChvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIGlmICghbm9Bc3NlcnQpIGNoZWNrT2Zmc2V0KG9mZnNldCwgNCwgdGhpcy5sZW5ndGgpXG4gIHJldHVybiBpZWVlNzU0LnJlYWQodGhpcywgb2Zmc2V0LCB0cnVlLCAyMywgNClcbn1cblxuQnVmZmVyLnByb3RvdHlwZS5yZWFkRmxvYXRCRSA9IGZ1bmN0aW9uIHJlYWRGbG9hdEJFIChvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIGlmICghbm9Bc3NlcnQpIGNoZWNrT2Zmc2V0KG9mZnNldCwgNCwgdGhpcy5sZW5ndGgpXG4gIHJldHVybiBpZWVlNzU0LnJlYWQodGhpcywgb2Zmc2V0LCBmYWxzZSwgMjMsIDQpXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUucmVhZERvdWJsZUxFID0gZnVuY3Rpb24gcmVhZERvdWJsZUxFIChvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIGlmICghbm9Bc3NlcnQpIGNoZWNrT2Zmc2V0KG9mZnNldCwgOCwgdGhpcy5sZW5ndGgpXG4gIHJldHVybiBpZWVlNzU0LnJlYWQodGhpcywgb2Zmc2V0LCB0cnVlLCA1MiwgOClcbn1cblxuQnVmZmVyLnByb3RvdHlwZS5yZWFkRG91YmxlQkUgPSBmdW5jdGlvbiByZWFkRG91YmxlQkUgKG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgaWYgKCFub0Fzc2VydCkgY2hlY2tPZmZzZXQob2Zmc2V0LCA4LCB0aGlzLmxlbmd0aClcbiAgcmV0dXJuIGllZWU3NTQucmVhZCh0aGlzLCBvZmZzZXQsIGZhbHNlLCA1MiwgOClcbn1cblxuZnVuY3Rpb24gY2hlY2tJbnQgKGJ1ZiwgdmFsdWUsIG9mZnNldCwgZXh0LCBtYXgsIG1pbikge1xuICBpZiAoIUJ1ZmZlci5pc0J1ZmZlcihidWYpKSB0aHJvdyBuZXcgVHlwZUVycm9yKCdidWZmZXIgbXVzdCBiZSBhIEJ1ZmZlciBpbnN0YW5jZScpXG4gIGlmICh2YWx1ZSA+IG1heCB8fCB2YWx1ZSA8IG1pbikgdGhyb3cgbmV3IFJhbmdlRXJyb3IoJ3ZhbHVlIGlzIG91dCBvZiBib3VuZHMnKVxuICBpZiAob2Zmc2V0ICsgZXh0ID4gYnVmLmxlbmd0aCkgdGhyb3cgbmV3IFJhbmdlRXJyb3IoJ2luZGV4IG91dCBvZiByYW5nZScpXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUud3JpdGVVSW50TEUgPSBmdW5jdGlvbiB3cml0ZVVJbnRMRSAodmFsdWUsIG9mZnNldCwgYnl0ZUxlbmd0aCwgbm9Bc3NlcnQpIHtcbiAgdmFsdWUgPSArdmFsdWVcbiAgb2Zmc2V0ID0gb2Zmc2V0ID4+PiAwXG4gIGJ5dGVMZW5ndGggPSBieXRlTGVuZ3RoID4+PiAwXG4gIGlmICghbm9Bc3NlcnQpIGNoZWNrSW50KHRoaXMsIHZhbHVlLCBvZmZzZXQsIGJ5dGVMZW5ndGgsIE1hdGgucG93KDIsIDggKiBieXRlTGVuZ3RoKSwgMClcblxuICB2YXIgbXVsID0gMVxuICB2YXIgaSA9IDBcbiAgdGhpc1tvZmZzZXRdID0gdmFsdWUgJiAweEZGXG4gIHdoaWxlICgrK2kgPCBieXRlTGVuZ3RoICYmIChtdWwgKj0gMHgxMDApKSB7XG4gICAgdGhpc1tvZmZzZXQgKyBpXSA9ICh2YWx1ZSAvIG11bCkgPj4+IDAgJiAweEZGXG4gIH1cblxuICByZXR1cm4gb2Zmc2V0ICsgYnl0ZUxlbmd0aFxufVxuXG5CdWZmZXIucHJvdG90eXBlLndyaXRlVUludEJFID0gZnVuY3Rpb24gd3JpdGVVSW50QkUgKHZhbHVlLCBvZmZzZXQsIGJ5dGVMZW5ndGgsIG5vQXNzZXJ0KSB7XG4gIHZhbHVlID0gK3ZhbHVlXG4gIG9mZnNldCA9IG9mZnNldCA+Pj4gMFxuICBieXRlTGVuZ3RoID0gYnl0ZUxlbmd0aCA+Pj4gMFxuICBpZiAoIW5vQXNzZXJ0KSBjaGVja0ludCh0aGlzLCB2YWx1ZSwgb2Zmc2V0LCBieXRlTGVuZ3RoLCBNYXRoLnBvdygyLCA4ICogYnl0ZUxlbmd0aCksIDApXG5cbiAgdmFyIGkgPSBieXRlTGVuZ3RoIC0gMVxuICB2YXIgbXVsID0gMVxuICB0aGlzW29mZnNldCArIGldID0gdmFsdWUgJiAweEZGXG4gIHdoaWxlICgtLWkgPj0gMCAmJiAobXVsICo9IDB4MTAwKSkge1xuICAgIHRoaXNbb2Zmc2V0ICsgaV0gPSAodmFsdWUgLyBtdWwpID4+PiAwICYgMHhGRlxuICB9XG5cbiAgcmV0dXJuIG9mZnNldCArIGJ5dGVMZW5ndGhcbn1cblxuQnVmZmVyLnByb3RvdHlwZS53cml0ZVVJbnQ4ID0gZnVuY3Rpb24gd3JpdGVVSW50OCAodmFsdWUsIG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgdmFsdWUgPSArdmFsdWVcbiAgb2Zmc2V0ID0gb2Zmc2V0ID4+PiAwXG4gIGlmICghbm9Bc3NlcnQpIGNoZWNrSW50KHRoaXMsIHZhbHVlLCBvZmZzZXQsIDEsIDB4ZmYsIDApXG4gIGlmICghQnVmZmVyLlRZUEVEX0FSUkFZX1NVUFBPUlQpIHZhbHVlID0gTWF0aC5mbG9vcih2YWx1ZSlcbiAgdGhpc1tvZmZzZXRdID0gdmFsdWVcbiAgcmV0dXJuIG9mZnNldCArIDFcbn1cblxuZnVuY3Rpb24gb2JqZWN0V3JpdGVVSW50MTYgKGJ1ZiwgdmFsdWUsIG9mZnNldCwgbGl0dGxlRW5kaWFuKSB7XG4gIGlmICh2YWx1ZSA8IDApIHZhbHVlID0gMHhmZmZmICsgdmFsdWUgKyAxXG4gIGZvciAodmFyIGkgPSAwLCBqID0gTWF0aC5taW4oYnVmLmxlbmd0aCAtIG9mZnNldCwgMik7IGkgPCBqOyBpKyspIHtcbiAgICBidWZbb2Zmc2V0ICsgaV0gPSAodmFsdWUgJiAoMHhmZiA8PCAoOCAqIChsaXR0bGVFbmRpYW4gPyBpIDogMSAtIGkpKSkpID4+PlxuICAgICAgKGxpdHRsZUVuZGlhbiA/IGkgOiAxIC0gaSkgKiA4XG4gIH1cbn1cblxuQnVmZmVyLnByb3RvdHlwZS53cml0ZVVJbnQxNkxFID0gZnVuY3Rpb24gd3JpdGVVSW50MTZMRSAodmFsdWUsIG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgdmFsdWUgPSArdmFsdWVcbiAgb2Zmc2V0ID0gb2Zmc2V0ID4+PiAwXG4gIGlmICghbm9Bc3NlcnQpIGNoZWNrSW50KHRoaXMsIHZhbHVlLCBvZmZzZXQsIDIsIDB4ZmZmZiwgMClcbiAgaWYgKEJ1ZmZlci5UWVBFRF9BUlJBWV9TVVBQT1JUKSB7XG4gICAgdGhpc1tvZmZzZXRdID0gdmFsdWVcbiAgICB0aGlzW29mZnNldCArIDFdID0gKHZhbHVlID4+PiA4KVxuICB9IGVsc2Uge1xuICAgIG9iamVjdFdyaXRlVUludDE2KHRoaXMsIHZhbHVlLCBvZmZzZXQsIHRydWUpXG4gIH1cbiAgcmV0dXJuIG9mZnNldCArIDJcbn1cblxuQnVmZmVyLnByb3RvdHlwZS53cml0ZVVJbnQxNkJFID0gZnVuY3Rpb24gd3JpdGVVSW50MTZCRSAodmFsdWUsIG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgdmFsdWUgPSArdmFsdWVcbiAgb2Zmc2V0ID0gb2Zmc2V0ID4+PiAwXG4gIGlmICghbm9Bc3NlcnQpIGNoZWNrSW50KHRoaXMsIHZhbHVlLCBvZmZzZXQsIDIsIDB4ZmZmZiwgMClcbiAgaWYgKEJ1ZmZlci5UWVBFRF9BUlJBWV9TVVBQT1JUKSB7XG4gICAgdGhpc1tvZmZzZXRdID0gKHZhbHVlID4+PiA4KVxuICAgIHRoaXNbb2Zmc2V0ICsgMV0gPSB2YWx1ZVxuICB9IGVsc2Uge1xuICAgIG9iamVjdFdyaXRlVUludDE2KHRoaXMsIHZhbHVlLCBvZmZzZXQsIGZhbHNlKVxuICB9XG4gIHJldHVybiBvZmZzZXQgKyAyXG59XG5cbmZ1bmN0aW9uIG9iamVjdFdyaXRlVUludDMyIChidWYsIHZhbHVlLCBvZmZzZXQsIGxpdHRsZUVuZGlhbikge1xuICBpZiAodmFsdWUgPCAwKSB2YWx1ZSA9IDB4ZmZmZmZmZmYgKyB2YWx1ZSArIDFcbiAgZm9yICh2YXIgaSA9IDAsIGogPSBNYXRoLm1pbihidWYubGVuZ3RoIC0gb2Zmc2V0LCA0KTsgaSA8IGo7IGkrKykge1xuICAgIGJ1ZltvZmZzZXQgKyBpXSA9ICh2YWx1ZSA+Pj4gKGxpdHRsZUVuZGlhbiA/IGkgOiAzIC0gaSkgKiA4KSAmIDB4ZmZcbiAgfVxufVxuXG5CdWZmZXIucHJvdG90eXBlLndyaXRlVUludDMyTEUgPSBmdW5jdGlvbiB3cml0ZVVJbnQzMkxFICh2YWx1ZSwgb2Zmc2V0LCBub0Fzc2VydCkge1xuICB2YWx1ZSA9ICt2YWx1ZVxuICBvZmZzZXQgPSBvZmZzZXQgPj4+IDBcbiAgaWYgKCFub0Fzc2VydCkgY2hlY2tJbnQodGhpcywgdmFsdWUsIG9mZnNldCwgNCwgMHhmZmZmZmZmZiwgMClcbiAgaWYgKEJ1ZmZlci5UWVBFRF9BUlJBWV9TVVBQT1JUKSB7XG4gICAgdGhpc1tvZmZzZXQgKyAzXSA9ICh2YWx1ZSA+Pj4gMjQpXG4gICAgdGhpc1tvZmZzZXQgKyAyXSA9ICh2YWx1ZSA+Pj4gMTYpXG4gICAgdGhpc1tvZmZzZXQgKyAxXSA9ICh2YWx1ZSA+Pj4gOClcbiAgICB0aGlzW29mZnNldF0gPSB2YWx1ZVxuICB9IGVsc2Uge1xuICAgIG9iamVjdFdyaXRlVUludDMyKHRoaXMsIHZhbHVlLCBvZmZzZXQsIHRydWUpXG4gIH1cbiAgcmV0dXJuIG9mZnNldCArIDRcbn1cblxuQnVmZmVyLnByb3RvdHlwZS53cml0ZVVJbnQzMkJFID0gZnVuY3Rpb24gd3JpdGVVSW50MzJCRSAodmFsdWUsIG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgdmFsdWUgPSArdmFsdWVcbiAgb2Zmc2V0ID0gb2Zmc2V0ID4+PiAwXG4gIGlmICghbm9Bc3NlcnQpIGNoZWNrSW50KHRoaXMsIHZhbHVlLCBvZmZzZXQsIDQsIDB4ZmZmZmZmZmYsIDApXG4gIGlmIChCdWZmZXIuVFlQRURfQVJSQVlfU1VQUE9SVCkge1xuICAgIHRoaXNbb2Zmc2V0XSA9ICh2YWx1ZSA+Pj4gMjQpXG4gICAgdGhpc1tvZmZzZXQgKyAxXSA9ICh2YWx1ZSA+Pj4gMTYpXG4gICAgdGhpc1tvZmZzZXQgKyAyXSA9ICh2YWx1ZSA+Pj4gOClcbiAgICB0aGlzW29mZnNldCArIDNdID0gdmFsdWVcbiAgfSBlbHNlIHtcbiAgICBvYmplY3RXcml0ZVVJbnQzMih0aGlzLCB2YWx1ZSwgb2Zmc2V0LCBmYWxzZSlcbiAgfVxuICByZXR1cm4gb2Zmc2V0ICsgNFxufVxuXG5CdWZmZXIucHJvdG90eXBlLndyaXRlSW50TEUgPSBmdW5jdGlvbiB3cml0ZUludExFICh2YWx1ZSwgb2Zmc2V0LCBieXRlTGVuZ3RoLCBub0Fzc2VydCkge1xuICB2YWx1ZSA9ICt2YWx1ZVxuICBvZmZzZXQgPSBvZmZzZXQgPj4+IDBcbiAgaWYgKCFub0Fzc2VydCkge1xuICAgIGNoZWNrSW50KFxuICAgICAgdGhpcywgdmFsdWUsIG9mZnNldCwgYnl0ZUxlbmd0aCxcbiAgICAgIE1hdGgucG93KDIsIDggKiBieXRlTGVuZ3RoIC0gMSkgLSAxLFxuICAgICAgLU1hdGgucG93KDIsIDggKiBieXRlTGVuZ3RoIC0gMSlcbiAgICApXG4gIH1cblxuICB2YXIgaSA9IDBcbiAgdmFyIG11bCA9IDFcbiAgdmFyIHN1YiA9IHZhbHVlIDwgMCA/IDEgOiAwXG4gIHRoaXNbb2Zmc2V0XSA9IHZhbHVlICYgMHhGRlxuICB3aGlsZSAoKytpIDwgYnl0ZUxlbmd0aCAmJiAobXVsICo9IDB4MTAwKSkge1xuICAgIHRoaXNbb2Zmc2V0ICsgaV0gPSAoKHZhbHVlIC8gbXVsKSA+PiAwKSAtIHN1YiAmIDB4RkZcbiAgfVxuXG4gIHJldHVybiBvZmZzZXQgKyBieXRlTGVuZ3RoXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUud3JpdGVJbnRCRSA9IGZ1bmN0aW9uIHdyaXRlSW50QkUgKHZhbHVlLCBvZmZzZXQsIGJ5dGVMZW5ndGgsIG5vQXNzZXJ0KSB7XG4gIHZhbHVlID0gK3ZhbHVlXG4gIG9mZnNldCA9IG9mZnNldCA+Pj4gMFxuICBpZiAoIW5vQXNzZXJ0KSB7XG4gICAgY2hlY2tJbnQoXG4gICAgICB0aGlzLCB2YWx1ZSwgb2Zmc2V0LCBieXRlTGVuZ3RoLFxuICAgICAgTWF0aC5wb3coMiwgOCAqIGJ5dGVMZW5ndGggLSAxKSAtIDEsXG4gICAgICAtTWF0aC5wb3coMiwgOCAqIGJ5dGVMZW5ndGggLSAxKVxuICAgIClcbiAgfVxuXG4gIHZhciBpID0gYnl0ZUxlbmd0aCAtIDFcbiAgdmFyIG11bCA9IDFcbiAgdmFyIHN1YiA9IHZhbHVlIDwgMCA/IDEgOiAwXG4gIHRoaXNbb2Zmc2V0ICsgaV0gPSB2YWx1ZSAmIDB4RkZcbiAgd2hpbGUgKC0taSA+PSAwICYmIChtdWwgKj0gMHgxMDApKSB7XG4gICAgdGhpc1tvZmZzZXQgKyBpXSA9ICgodmFsdWUgLyBtdWwpID4+IDApIC0gc3ViICYgMHhGRlxuICB9XG5cbiAgcmV0dXJuIG9mZnNldCArIGJ5dGVMZW5ndGhcbn1cblxuQnVmZmVyLnByb3RvdHlwZS53cml0ZUludDggPSBmdW5jdGlvbiB3cml0ZUludDggKHZhbHVlLCBvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIHZhbHVlID0gK3ZhbHVlXG4gIG9mZnNldCA9IG9mZnNldCA+Pj4gMFxuICBpZiAoIW5vQXNzZXJ0KSBjaGVja0ludCh0aGlzLCB2YWx1ZSwgb2Zmc2V0LCAxLCAweDdmLCAtMHg4MClcbiAgaWYgKCFCdWZmZXIuVFlQRURfQVJSQVlfU1VQUE9SVCkgdmFsdWUgPSBNYXRoLmZsb29yKHZhbHVlKVxuICBpZiAodmFsdWUgPCAwKSB2YWx1ZSA9IDB4ZmYgKyB2YWx1ZSArIDFcbiAgdGhpc1tvZmZzZXRdID0gdmFsdWVcbiAgcmV0dXJuIG9mZnNldCArIDFcbn1cblxuQnVmZmVyLnByb3RvdHlwZS53cml0ZUludDE2TEUgPSBmdW5jdGlvbiB3cml0ZUludDE2TEUgKHZhbHVlLCBvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIHZhbHVlID0gK3ZhbHVlXG4gIG9mZnNldCA9IG9mZnNldCA+Pj4gMFxuICBpZiAoIW5vQXNzZXJ0KSBjaGVja0ludCh0aGlzLCB2YWx1ZSwgb2Zmc2V0LCAyLCAweDdmZmYsIC0weDgwMDApXG4gIGlmIChCdWZmZXIuVFlQRURfQVJSQVlfU1VQUE9SVCkge1xuICAgIHRoaXNbb2Zmc2V0XSA9IHZhbHVlXG4gICAgdGhpc1tvZmZzZXQgKyAxXSA9ICh2YWx1ZSA+Pj4gOClcbiAgfSBlbHNlIHtcbiAgICBvYmplY3RXcml0ZVVJbnQxNih0aGlzLCB2YWx1ZSwgb2Zmc2V0LCB0cnVlKVxuICB9XG4gIHJldHVybiBvZmZzZXQgKyAyXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUud3JpdGVJbnQxNkJFID0gZnVuY3Rpb24gd3JpdGVJbnQxNkJFICh2YWx1ZSwgb2Zmc2V0LCBub0Fzc2VydCkge1xuICB2YWx1ZSA9ICt2YWx1ZVxuICBvZmZzZXQgPSBvZmZzZXQgPj4+IDBcbiAgaWYgKCFub0Fzc2VydCkgY2hlY2tJbnQodGhpcywgdmFsdWUsIG9mZnNldCwgMiwgMHg3ZmZmLCAtMHg4MDAwKVxuICBpZiAoQnVmZmVyLlRZUEVEX0FSUkFZX1NVUFBPUlQpIHtcbiAgICB0aGlzW29mZnNldF0gPSAodmFsdWUgPj4+IDgpXG4gICAgdGhpc1tvZmZzZXQgKyAxXSA9IHZhbHVlXG4gIH0gZWxzZSB7XG4gICAgb2JqZWN0V3JpdGVVSW50MTYodGhpcywgdmFsdWUsIG9mZnNldCwgZmFsc2UpXG4gIH1cbiAgcmV0dXJuIG9mZnNldCArIDJcbn1cblxuQnVmZmVyLnByb3RvdHlwZS53cml0ZUludDMyTEUgPSBmdW5jdGlvbiB3cml0ZUludDMyTEUgKHZhbHVlLCBvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIHZhbHVlID0gK3ZhbHVlXG4gIG9mZnNldCA9IG9mZnNldCA+Pj4gMFxuICBpZiAoIW5vQXNzZXJ0KSBjaGVja0ludCh0aGlzLCB2YWx1ZSwgb2Zmc2V0LCA0LCAweDdmZmZmZmZmLCAtMHg4MDAwMDAwMClcbiAgaWYgKEJ1ZmZlci5UWVBFRF9BUlJBWV9TVVBQT1JUKSB7XG4gICAgdGhpc1tvZmZzZXRdID0gdmFsdWVcbiAgICB0aGlzW29mZnNldCArIDFdID0gKHZhbHVlID4+PiA4KVxuICAgIHRoaXNbb2Zmc2V0ICsgMl0gPSAodmFsdWUgPj4+IDE2KVxuICAgIHRoaXNbb2Zmc2V0ICsgM10gPSAodmFsdWUgPj4+IDI0KVxuICB9IGVsc2Uge1xuICAgIG9iamVjdFdyaXRlVUludDMyKHRoaXMsIHZhbHVlLCBvZmZzZXQsIHRydWUpXG4gIH1cbiAgcmV0dXJuIG9mZnNldCArIDRcbn1cblxuQnVmZmVyLnByb3RvdHlwZS53cml0ZUludDMyQkUgPSBmdW5jdGlvbiB3cml0ZUludDMyQkUgKHZhbHVlLCBvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIHZhbHVlID0gK3ZhbHVlXG4gIG9mZnNldCA9IG9mZnNldCA+Pj4gMFxuICBpZiAoIW5vQXNzZXJ0KSBjaGVja0ludCh0aGlzLCB2YWx1ZSwgb2Zmc2V0LCA0LCAweDdmZmZmZmZmLCAtMHg4MDAwMDAwMClcbiAgaWYgKHZhbHVlIDwgMCkgdmFsdWUgPSAweGZmZmZmZmZmICsgdmFsdWUgKyAxXG4gIGlmIChCdWZmZXIuVFlQRURfQVJSQVlfU1VQUE9SVCkge1xuICAgIHRoaXNbb2Zmc2V0XSA9ICh2YWx1ZSA+Pj4gMjQpXG4gICAgdGhpc1tvZmZzZXQgKyAxXSA9ICh2YWx1ZSA+Pj4gMTYpXG4gICAgdGhpc1tvZmZzZXQgKyAyXSA9ICh2YWx1ZSA+Pj4gOClcbiAgICB0aGlzW29mZnNldCArIDNdID0gdmFsdWVcbiAgfSBlbHNlIHtcbiAgICBvYmplY3RXcml0ZVVJbnQzMih0aGlzLCB2YWx1ZSwgb2Zmc2V0LCBmYWxzZSlcbiAgfVxuICByZXR1cm4gb2Zmc2V0ICsgNFxufVxuXG5mdW5jdGlvbiBjaGVja0lFRUU3NTQgKGJ1ZiwgdmFsdWUsIG9mZnNldCwgZXh0LCBtYXgsIG1pbikge1xuICBpZiAodmFsdWUgPiBtYXggfHwgdmFsdWUgPCBtaW4pIHRocm93IG5ldyBSYW5nZUVycm9yKCd2YWx1ZSBpcyBvdXQgb2YgYm91bmRzJylcbiAgaWYgKG9mZnNldCArIGV4dCA+IGJ1Zi5sZW5ndGgpIHRocm93IG5ldyBSYW5nZUVycm9yKCdpbmRleCBvdXQgb2YgcmFuZ2UnKVxuICBpZiAob2Zmc2V0IDwgMCkgdGhyb3cgbmV3IFJhbmdlRXJyb3IoJ2luZGV4IG91dCBvZiByYW5nZScpXG59XG5cbmZ1bmN0aW9uIHdyaXRlRmxvYXQgKGJ1ZiwgdmFsdWUsIG9mZnNldCwgbGl0dGxlRW5kaWFuLCBub0Fzc2VydCkge1xuICBpZiAoIW5vQXNzZXJ0KSB7XG4gICAgY2hlY2tJRUVFNzU0KGJ1ZiwgdmFsdWUsIG9mZnNldCwgNCwgMy40MDI4MjM0NjYzODUyODg2ZSszOCwgLTMuNDAyODIzNDY2Mzg1Mjg4NmUrMzgpXG4gIH1cbiAgaWVlZTc1NC53cml0ZShidWYsIHZhbHVlLCBvZmZzZXQsIGxpdHRsZUVuZGlhbiwgMjMsIDQpXG4gIHJldHVybiBvZmZzZXQgKyA0XG59XG5cbkJ1ZmZlci5wcm90b3R5cGUud3JpdGVGbG9hdExFID0gZnVuY3Rpb24gd3JpdGVGbG9hdExFICh2YWx1ZSwgb2Zmc2V0LCBub0Fzc2VydCkge1xuICByZXR1cm4gd3JpdGVGbG9hdCh0aGlzLCB2YWx1ZSwgb2Zmc2V0LCB0cnVlLCBub0Fzc2VydClcbn1cblxuQnVmZmVyLnByb3RvdHlwZS53cml0ZUZsb2F0QkUgPSBmdW5jdGlvbiB3cml0ZUZsb2F0QkUgKHZhbHVlLCBvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIHJldHVybiB3cml0ZUZsb2F0KHRoaXMsIHZhbHVlLCBvZmZzZXQsIGZhbHNlLCBub0Fzc2VydClcbn1cblxuZnVuY3Rpb24gd3JpdGVEb3VibGUgKGJ1ZiwgdmFsdWUsIG9mZnNldCwgbGl0dGxlRW5kaWFuLCBub0Fzc2VydCkge1xuICBpZiAoIW5vQXNzZXJ0KSB7XG4gICAgY2hlY2tJRUVFNzU0KGJ1ZiwgdmFsdWUsIG9mZnNldCwgOCwgMS43OTc2OTMxMzQ4NjIzMTU3RSszMDgsIC0xLjc5NzY5MzEzNDg2MjMxNTdFKzMwOClcbiAgfVxuICBpZWVlNzU0LndyaXRlKGJ1ZiwgdmFsdWUsIG9mZnNldCwgbGl0dGxlRW5kaWFuLCA1MiwgOClcbiAgcmV0dXJuIG9mZnNldCArIDhcbn1cblxuQnVmZmVyLnByb3RvdHlwZS53cml0ZURvdWJsZUxFID0gZnVuY3Rpb24gd3JpdGVEb3VibGVMRSAodmFsdWUsIG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgcmV0dXJuIHdyaXRlRG91YmxlKHRoaXMsIHZhbHVlLCBvZmZzZXQsIHRydWUsIG5vQXNzZXJ0KVxufVxuXG5CdWZmZXIucHJvdG90eXBlLndyaXRlRG91YmxlQkUgPSBmdW5jdGlvbiB3cml0ZURvdWJsZUJFICh2YWx1ZSwgb2Zmc2V0LCBub0Fzc2VydCkge1xuICByZXR1cm4gd3JpdGVEb3VibGUodGhpcywgdmFsdWUsIG9mZnNldCwgZmFsc2UsIG5vQXNzZXJ0KVxufVxuXG4vLyBjb3B5KHRhcmdldEJ1ZmZlciwgdGFyZ2V0U3RhcnQ9MCwgc291cmNlU3RhcnQ9MCwgc291cmNlRW5kPWJ1ZmZlci5sZW5ndGgpXG5CdWZmZXIucHJvdG90eXBlLmNvcHkgPSBmdW5jdGlvbiBjb3B5ICh0YXJnZXQsIHRhcmdldF9zdGFydCwgc3RhcnQsIGVuZCkge1xuICBpZiAoIXN0YXJ0KSBzdGFydCA9IDBcbiAgaWYgKCFlbmQgJiYgZW5kICE9PSAwKSBlbmQgPSB0aGlzLmxlbmd0aFxuICBpZiAodGFyZ2V0X3N0YXJ0ID49IHRhcmdldC5sZW5ndGgpIHRhcmdldF9zdGFydCA9IHRhcmdldC5sZW5ndGhcbiAgaWYgKCF0YXJnZXRfc3RhcnQpIHRhcmdldF9zdGFydCA9IDBcbiAgaWYgKGVuZCA+IDAgJiYgZW5kIDwgc3RhcnQpIGVuZCA9IHN0YXJ0XG5cbiAgLy8gQ29weSAwIGJ5dGVzOyB3ZSdyZSBkb25lXG4gIGlmIChlbmQgPT09IHN0YXJ0KSByZXR1cm4gMFxuICBpZiAodGFyZ2V0Lmxlbmd0aCA9PT0gMCB8fCB0aGlzLmxlbmd0aCA9PT0gMCkgcmV0dXJuIDBcblxuICAvLyBGYXRhbCBlcnJvciBjb25kaXRpb25zXG4gIGlmICh0YXJnZXRfc3RhcnQgPCAwKSB7XG4gICAgdGhyb3cgbmV3IFJhbmdlRXJyb3IoJ3RhcmdldFN0YXJ0IG91dCBvZiBib3VuZHMnKVxuICB9XG4gIGlmIChzdGFydCA8IDAgfHwgc3RhcnQgPj0gdGhpcy5sZW5ndGgpIHRocm93IG5ldyBSYW5nZUVycm9yKCdzb3VyY2VTdGFydCBvdXQgb2YgYm91bmRzJylcbiAgaWYgKGVuZCA8IDApIHRocm93IG5ldyBSYW5nZUVycm9yKCdzb3VyY2VFbmQgb3V0IG9mIGJvdW5kcycpXG5cbiAgLy8gQXJlIHdlIG9vYj9cbiAgaWYgKGVuZCA+IHRoaXMubGVuZ3RoKSBlbmQgPSB0aGlzLmxlbmd0aFxuICBpZiAodGFyZ2V0Lmxlbmd0aCAtIHRhcmdldF9zdGFydCA8IGVuZCAtIHN0YXJ0KSB7XG4gICAgZW5kID0gdGFyZ2V0Lmxlbmd0aCAtIHRhcmdldF9zdGFydCArIHN0YXJ0XG4gIH1cblxuICB2YXIgbGVuID0gZW5kIC0gc3RhcnRcblxuICBpZiAobGVuIDwgMTAwMCB8fCAhQnVmZmVyLlRZUEVEX0FSUkFZX1NVUFBPUlQpIHtcbiAgICBmb3IgKHZhciBpID0gMDsgaSA8IGxlbjsgaSsrKSB7XG4gICAgICB0YXJnZXRbaSArIHRhcmdldF9zdGFydF0gPSB0aGlzW2kgKyBzdGFydF1cbiAgICB9XG4gIH0gZWxzZSB7XG4gICAgdGFyZ2V0Ll9zZXQodGhpcy5zdWJhcnJheShzdGFydCwgc3RhcnQgKyBsZW4pLCB0YXJnZXRfc3RhcnQpXG4gIH1cblxuICByZXR1cm4gbGVuXG59XG5cbi8vIGZpbGwodmFsdWUsIHN0YXJ0PTAsIGVuZD1idWZmZXIubGVuZ3RoKVxuQnVmZmVyLnByb3RvdHlwZS5maWxsID0gZnVuY3Rpb24gZmlsbCAodmFsdWUsIHN0YXJ0LCBlbmQpIHtcbiAgaWYgKCF2YWx1ZSkgdmFsdWUgPSAwXG4gIGlmICghc3RhcnQpIHN0YXJ0ID0gMFxuICBpZiAoIWVuZCkgZW5kID0gdGhpcy5sZW5ndGhcblxuICBpZiAoZW5kIDwgc3RhcnQpIHRocm93IG5ldyBSYW5nZUVycm9yKCdlbmQgPCBzdGFydCcpXG5cbiAgLy8gRmlsbCAwIGJ5dGVzOyB3ZSdyZSBkb25lXG4gIGlmIChlbmQgPT09IHN0YXJ0KSByZXR1cm5cbiAgaWYgKHRoaXMubGVuZ3RoID09PSAwKSByZXR1cm5cblxuICBpZiAoc3RhcnQgPCAwIHx8IHN0YXJ0ID49IHRoaXMubGVuZ3RoKSB0aHJvdyBuZXcgUmFuZ2VFcnJvcignc3RhcnQgb3V0IG9mIGJvdW5kcycpXG4gIGlmIChlbmQgPCAwIHx8IGVuZCA+IHRoaXMubGVuZ3RoKSB0aHJvdyBuZXcgUmFuZ2VFcnJvcignZW5kIG91dCBvZiBib3VuZHMnKVxuXG4gIHZhciBpXG4gIGlmICh0eXBlb2YgdmFsdWUgPT09ICdudW1iZXInKSB7XG4gICAgZm9yIChpID0gc3RhcnQ7IGkgPCBlbmQ7IGkrKykge1xuICAgICAgdGhpc1tpXSA9IHZhbHVlXG4gICAgfVxuICB9IGVsc2Uge1xuICAgIHZhciBieXRlcyA9IHV0ZjhUb0J5dGVzKHZhbHVlLnRvU3RyaW5nKCkpXG4gICAgdmFyIGxlbiA9IGJ5dGVzLmxlbmd0aFxuICAgIGZvciAoaSA9IHN0YXJ0OyBpIDwgZW5kOyBpKyspIHtcbiAgICAgIHRoaXNbaV0gPSBieXRlc1tpICUgbGVuXVxuICAgIH1cbiAgfVxuXG4gIHJldHVybiB0aGlzXG59XG5cbi8qKlxuICogQ3JlYXRlcyBhIG5ldyBgQXJyYXlCdWZmZXJgIHdpdGggdGhlICpjb3BpZWQqIG1lbW9yeSBvZiB0aGUgYnVmZmVyIGluc3RhbmNlLlxuICogQWRkZWQgaW4gTm9kZSAwLjEyLiBPbmx5IGF2YWlsYWJsZSBpbiBicm93c2VycyB0aGF0IHN1cHBvcnQgQXJyYXlCdWZmZXIuXG4gKi9cbkJ1ZmZlci5wcm90b3R5cGUudG9BcnJheUJ1ZmZlciA9IGZ1bmN0aW9uIHRvQXJyYXlCdWZmZXIgKCkge1xuICBpZiAodHlwZW9mIFVpbnQ4QXJyYXkgIT09ICd1bmRlZmluZWQnKSB7XG4gICAgaWYgKEJ1ZmZlci5UWVBFRF9BUlJBWV9TVVBQT1JUKSB7XG4gICAgICByZXR1cm4gKG5ldyBCdWZmZXIodGhpcykpLmJ1ZmZlclxuICAgIH0gZWxzZSB7XG4gICAgICB2YXIgYnVmID0gbmV3IFVpbnQ4QXJyYXkodGhpcy5sZW5ndGgpXG4gICAgICBmb3IgKHZhciBpID0gMCwgbGVuID0gYnVmLmxlbmd0aDsgaSA8IGxlbjsgaSArPSAxKSB7XG4gICAgICAgIGJ1ZltpXSA9IHRoaXNbaV1cbiAgICAgIH1cbiAgICAgIHJldHVybiBidWYuYnVmZmVyXG4gICAgfVxuICB9IGVsc2Uge1xuICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ0J1ZmZlci50b0FycmF5QnVmZmVyIG5vdCBzdXBwb3J0ZWQgaW4gdGhpcyBicm93c2VyJylcbiAgfVxufVxuXG4vLyBIRUxQRVIgRlVOQ1RJT05TXG4vLyA9PT09PT09PT09PT09PT09XG5cbnZhciBCUCA9IEJ1ZmZlci5wcm90b3R5cGVcblxuLyoqXG4gKiBBdWdtZW50IGEgVWludDhBcnJheSAqaW5zdGFuY2UqIChub3QgdGhlIFVpbnQ4QXJyYXkgY2xhc3MhKSB3aXRoIEJ1ZmZlciBtZXRob2RzXG4gKi9cbkJ1ZmZlci5fYXVnbWVudCA9IGZ1bmN0aW9uIF9hdWdtZW50IChhcnIpIHtcbiAgYXJyLmNvbnN0cnVjdG9yID0gQnVmZmVyXG4gIGFyci5faXNCdWZmZXIgPSB0cnVlXG5cbiAgLy8gc2F2ZSByZWZlcmVuY2UgdG8gb3JpZ2luYWwgVWludDhBcnJheSBzZXQgbWV0aG9kIGJlZm9yZSBvdmVyd3JpdGluZ1xuICBhcnIuX3NldCA9IGFyci5zZXRcblxuICAvLyBkZXByZWNhdGVkLCB3aWxsIGJlIHJlbW92ZWQgaW4gbm9kZSAwLjEzK1xuICBhcnIuZ2V0ID0gQlAuZ2V0XG4gIGFyci5zZXQgPSBCUC5zZXRcblxuICBhcnIud3JpdGUgPSBCUC53cml0ZVxuICBhcnIudG9TdHJpbmcgPSBCUC50b1N0cmluZ1xuICBhcnIudG9Mb2NhbGVTdHJpbmcgPSBCUC50b1N0cmluZ1xuICBhcnIudG9KU09OID0gQlAudG9KU09OXG4gIGFyci5lcXVhbHMgPSBCUC5lcXVhbHNcbiAgYXJyLmNvbXBhcmUgPSBCUC5jb21wYXJlXG4gIGFyci5pbmRleE9mID0gQlAuaW5kZXhPZlxuICBhcnIuY29weSA9IEJQLmNvcHlcbiAgYXJyLnNsaWNlID0gQlAuc2xpY2VcbiAgYXJyLnJlYWRVSW50TEUgPSBCUC5yZWFkVUludExFXG4gIGFyci5yZWFkVUludEJFID0gQlAucmVhZFVJbnRCRVxuICBhcnIucmVhZFVJbnQ4ID0gQlAucmVhZFVJbnQ4XG4gIGFyci5yZWFkVUludDE2TEUgPSBCUC5yZWFkVUludDE2TEVcbiAgYXJyLnJlYWRVSW50MTZCRSA9IEJQLnJlYWRVSW50MTZCRVxuICBhcnIucmVhZFVJbnQzMkxFID0gQlAucmVhZFVJbnQzMkxFXG4gIGFyci5yZWFkVUludDMyQkUgPSBCUC5yZWFkVUludDMyQkVcbiAgYXJyLnJlYWRJbnRMRSA9IEJQLnJlYWRJbnRMRVxuICBhcnIucmVhZEludEJFID0gQlAucmVhZEludEJFXG4gIGFyci5yZWFkSW50OCA9IEJQLnJlYWRJbnQ4XG4gIGFyci5yZWFkSW50MTZMRSA9IEJQLnJlYWRJbnQxNkxFXG4gIGFyci5yZWFkSW50MTZCRSA9IEJQLnJlYWRJbnQxNkJFXG4gIGFyci5yZWFkSW50MzJMRSA9IEJQLnJlYWRJbnQzMkxFXG4gIGFyci5yZWFkSW50MzJCRSA9IEJQLnJlYWRJbnQzMkJFXG4gIGFyci5yZWFkRmxvYXRMRSA9IEJQLnJlYWRGbG9hdExFXG4gIGFyci5yZWFkRmxvYXRCRSA9IEJQLnJlYWRGbG9hdEJFXG4gIGFyci5yZWFkRG91YmxlTEUgPSBCUC5yZWFkRG91YmxlTEVcbiAgYXJyLnJlYWREb3VibGVCRSA9IEJQLnJlYWREb3VibGVCRVxuICBhcnIud3JpdGVVSW50OCA9IEJQLndyaXRlVUludDhcbiAgYXJyLndyaXRlVUludExFID0gQlAud3JpdGVVSW50TEVcbiAgYXJyLndyaXRlVUludEJFID0gQlAud3JpdGVVSW50QkVcbiAgYXJyLndyaXRlVUludDE2TEUgPSBCUC53cml0ZVVJbnQxNkxFXG4gIGFyci53cml0ZVVJbnQxNkJFID0gQlAud3JpdGVVSW50MTZCRVxuICBhcnIud3JpdGVVSW50MzJMRSA9IEJQLndyaXRlVUludDMyTEVcbiAgYXJyLndyaXRlVUludDMyQkUgPSBCUC53cml0ZVVJbnQzMkJFXG4gIGFyci53cml0ZUludExFID0gQlAud3JpdGVJbnRMRVxuICBhcnIud3JpdGVJbnRCRSA9IEJQLndyaXRlSW50QkVcbiAgYXJyLndyaXRlSW50OCA9IEJQLndyaXRlSW50OFxuICBhcnIud3JpdGVJbnQxNkxFID0gQlAud3JpdGVJbnQxNkxFXG4gIGFyci53cml0ZUludDE2QkUgPSBCUC53cml0ZUludDE2QkVcbiAgYXJyLndyaXRlSW50MzJMRSA9IEJQLndyaXRlSW50MzJMRVxuICBhcnIud3JpdGVJbnQzMkJFID0gQlAud3JpdGVJbnQzMkJFXG4gIGFyci53cml0ZUZsb2F0TEUgPSBCUC53cml0ZUZsb2F0TEVcbiAgYXJyLndyaXRlRmxvYXRCRSA9IEJQLndyaXRlRmxvYXRCRVxuICBhcnIud3JpdGVEb3VibGVMRSA9IEJQLndyaXRlRG91YmxlTEVcbiAgYXJyLndyaXRlRG91YmxlQkUgPSBCUC53cml0ZURvdWJsZUJFXG4gIGFyci5maWxsID0gQlAuZmlsbFxuICBhcnIuaW5zcGVjdCA9IEJQLmluc3BlY3RcbiAgYXJyLnRvQXJyYXlCdWZmZXIgPSBCUC50b0FycmF5QnVmZmVyXG5cbiAgcmV0dXJuIGFyclxufVxuXG52YXIgSU5WQUxJRF9CQVNFNjRfUkUgPSAvW14rXFwvMC05QS16XFwtXS9nXG5cbmZ1bmN0aW9uIGJhc2U2NGNsZWFuIChzdHIpIHtcbiAgLy8gTm9kZSBzdHJpcHMgb3V0IGludmFsaWQgY2hhcmFjdGVycyBsaWtlIFxcbiBhbmQgXFx0IGZyb20gdGhlIHN0cmluZywgYmFzZTY0LWpzIGRvZXMgbm90XG4gIHN0ciA9IHN0cmluZ3RyaW0oc3RyKS5yZXBsYWNlKElOVkFMSURfQkFTRTY0X1JFLCAnJylcbiAgLy8gTm9kZSBjb252ZXJ0cyBzdHJpbmdzIHdpdGggbGVuZ3RoIDwgMiB0byAnJ1xuICBpZiAoc3RyLmxlbmd0aCA8IDIpIHJldHVybiAnJ1xuICAvLyBOb2RlIGFsbG93cyBmb3Igbm9uLXBhZGRlZCBiYXNlNjQgc3RyaW5ncyAobWlzc2luZyB0cmFpbGluZyA9PT0pLCBiYXNlNjQtanMgZG9lcyBub3RcbiAgd2hpbGUgKHN0ci5sZW5ndGggJSA0ICE9PSAwKSB7XG4gICAgc3RyID0gc3RyICsgJz0nXG4gIH1cbiAgcmV0dXJuIHN0clxufVxuXG5mdW5jdGlvbiBzdHJpbmd0cmltIChzdHIpIHtcbiAgaWYgKHN0ci50cmltKSByZXR1cm4gc3RyLnRyaW0oKVxuICByZXR1cm4gc3RyLnJlcGxhY2UoL15cXHMrfFxccyskL2csICcnKVxufVxuXG5mdW5jdGlvbiBpc0FycmF5aXNoIChzdWJqZWN0KSB7XG4gIHJldHVybiBpc0FycmF5KHN1YmplY3QpIHx8IEJ1ZmZlci5pc0J1ZmZlcihzdWJqZWN0KSB8fFxuICAgICAgc3ViamVjdCAmJiB0eXBlb2Ygc3ViamVjdCA9PT0gJ29iamVjdCcgJiZcbiAgICAgIHR5cGVvZiBzdWJqZWN0Lmxlbmd0aCA9PT0gJ251bWJlcidcbn1cblxuZnVuY3Rpb24gdG9IZXggKG4pIHtcbiAgaWYgKG4gPCAxNikgcmV0dXJuICcwJyArIG4udG9TdHJpbmcoMTYpXG4gIHJldHVybiBuLnRvU3RyaW5nKDE2KVxufVxuXG5mdW5jdGlvbiB1dGY4VG9CeXRlcyAoc3RyaW5nLCB1bml0cykge1xuICB1bml0cyA9IHVuaXRzIHx8IEluZmluaXR5XG4gIHZhciBjb2RlUG9pbnRcbiAgdmFyIGxlbmd0aCA9IHN0cmluZy5sZW5ndGhcbiAgdmFyIGxlYWRTdXJyb2dhdGUgPSBudWxsXG4gIHZhciBieXRlcyA9IFtdXG4gIHZhciBpID0gMFxuXG4gIGZvciAoOyBpIDwgbGVuZ3RoOyBpKyspIHtcbiAgICBjb2RlUG9pbnQgPSBzdHJpbmcuY2hhckNvZGVBdChpKVxuXG4gICAgLy8gaXMgc3Vycm9nYXRlIGNvbXBvbmVudFxuICAgIGlmIChjb2RlUG9pbnQgPiAweEQ3RkYgJiYgY29kZVBvaW50IDwgMHhFMDAwKSB7XG4gICAgICAvLyBsYXN0IGNoYXIgd2FzIGEgbGVhZFxuICAgICAgaWYgKGxlYWRTdXJyb2dhdGUpIHtcbiAgICAgICAgLy8gMiBsZWFkcyBpbiBhIHJvd1xuICAgICAgICBpZiAoY29kZVBvaW50IDwgMHhEQzAwKSB7XG4gICAgICAgICAgaWYgKCh1bml0cyAtPSAzKSA+IC0xKSBieXRlcy5wdXNoKDB4RUYsIDB4QkYsIDB4QkQpXG4gICAgICAgICAgbGVhZFN1cnJvZ2F0ZSA9IGNvZGVQb2ludFxuICAgICAgICAgIGNvbnRpbnVlXG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgLy8gdmFsaWQgc3Vycm9nYXRlIHBhaXJcbiAgICAgICAgICBjb2RlUG9pbnQgPSBsZWFkU3Vycm9nYXRlIC0gMHhEODAwIDw8IDEwIHwgY29kZVBvaW50IC0gMHhEQzAwIHwgMHgxMDAwMFxuICAgICAgICAgIGxlYWRTdXJyb2dhdGUgPSBudWxsXG4gICAgICAgIH1cbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIC8vIG5vIGxlYWQgeWV0XG5cbiAgICAgICAgaWYgKGNvZGVQb2ludCA+IDB4REJGRikge1xuICAgICAgICAgIC8vIHVuZXhwZWN0ZWQgdHJhaWxcbiAgICAgICAgICBpZiAoKHVuaXRzIC09IDMpID4gLTEpIGJ5dGVzLnB1c2goMHhFRiwgMHhCRiwgMHhCRClcbiAgICAgICAgICBjb250aW51ZVxuICAgICAgICB9IGVsc2UgaWYgKGkgKyAxID09PSBsZW5ndGgpIHtcbiAgICAgICAgICAvLyB1bnBhaXJlZCBsZWFkXG4gICAgICAgICAgaWYgKCh1bml0cyAtPSAzKSA+IC0xKSBieXRlcy5wdXNoKDB4RUYsIDB4QkYsIDB4QkQpXG4gICAgICAgICAgY29udGludWVcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAvLyB2YWxpZCBsZWFkXG4gICAgICAgICAgbGVhZFN1cnJvZ2F0ZSA9IGNvZGVQb2ludFxuICAgICAgICAgIGNvbnRpbnVlXG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9IGVsc2UgaWYgKGxlYWRTdXJyb2dhdGUpIHtcbiAgICAgIC8vIHZhbGlkIGJtcCBjaGFyLCBidXQgbGFzdCBjaGFyIHdhcyBhIGxlYWRcbiAgICAgIGlmICgodW5pdHMgLT0gMykgPiAtMSkgYnl0ZXMucHVzaCgweEVGLCAweEJGLCAweEJEKVxuICAgICAgbGVhZFN1cnJvZ2F0ZSA9IG51bGxcbiAgICB9XG5cbiAgICAvLyBlbmNvZGUgdXRmOFxuICAgIGlmIChjb2RlUG9pbnQgPCAweDgwKSB7XG4gICAgICBpZiAoKHVuaXRzIC09IDEpIDwgMCkgYnJlYWtcbiAgICAgIGJ5dGVzLnB1c2goY29kZVBvaW50KVxuICAgIH0gZWxzZSBpZiAoY29kZVBvaW50IDwgMHg4MDApIHtcbiAgICAgIGlmICgodW5pdHMgLT0gMikgPCAwKSBicmVha1xuICAgICAgYnl0ZXMucHVzaChcbiAgICAgICAgY29kZVBvaW50ID4+IDB4NiB8IDB4QzAsXG4gICAgICAgIGNvZGVQb2ludCAmIDB4M0YgfCAweDgwXG4gICAgICApXG4gICAgfSBlbHNlIGlmIChjb2RlUG9pbnQgPCAweDEwMDAwKSB7XG4gICAgICBpZiAoKHVuaXRzIC09IDMpIDwgMCkgYnJlYWtcbiAgICAgIGJ5dGVzLnB1c2goXG4gICAgICAgIGNvZGVQb2ludCA+PiAweEMgfCAweEUwLFxuICAgICAgICBjb2RlUG9pbnQgPj4gMHg2ICYgMHgzRiB8IDB4ODAsXG4gICAgICAgIGNvZGVQb2ludCAmIDB4M0YgfCAweDgwXG4gICAgICApXG4gICAgfSBlbHNlIGlmIChjb2RlUG9pbnQgPCAweDIwMDAwMCkge1xuICAgICAgaWYgKCh1bml0cyAtPSA0KSA8IDApIGJyZWFrXG4gICAgICBieXRlcy5wdXNoKFxuICAgICAgICBjb2RlUG9pbnQgPj4gMHgxMiB8IDB4RjAsXG4gICAgICAgIGNvZGVQb2ludCA+PiAweEMgJiAweDNGIHwgMHg4MCxcbiAgICAgICAgY29kZVBvaW50ID4+IDB4NiAmIDB4M0YgfCAweDgwLFxuICAgICAgICBjb2RlUG9pbnQgJiAweDNGIHwgMHg4MFxuICAgICAgKVxuICAgIH0gZWxzZSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ0ludmFsaWQgY29kZSBwb2ludCcpXG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIGJ5dGVzXG59XG5cbmZ1bmN0aW9uIGFzY2lpVG9CeXRlcyAoc3RyKSB7XG4gIHZhciBieXRlQXJyYXkgPSBbXVxuICBmb3IgKHZhciBpID0gMDsgaSA8IHN0ci5sZW5ndGg7IGkrKykge1xuICAgIC8vIE5vZGUncyBjb2RlIHNlZW1zIHRvIGJlIGRvaW5nIHRoaXMgYW5kIG5vdCAmIDB4N0YuLlxuICAgIGJ5dGVBcnJheS5wdXNoKHN0ci5jaGFyQ29kZUF0KGkpICYgMHhGRilcbiAgfVxuICByZXR1cm4gYnl0ZUFycmF5XG59XG5cbmZ1bmN0aW9uIHV0ZjE2bGVUb0J5dGVzIChzdHIsIHVuaXRzKSB7XG4gIHZhciBjLCBoaSwgbG9cbiAgdmFyIGJ5dGVBcnJheSA9IFtdXG4gIGZvciAodmFyIGkgPSAwOyBpIDwgc3RyLmxlbmd0aDsgaSsrKSB7XG4gICAgaWYgKCh1bml0cyAtPSAyKSA8IDApIGJyZWFrXG5cbiAgICBjID0gc3RyLmNoYXJDb2RlQXQoaSlcbiAgICBoaSA9IGMgPj4gOFxuICAgIGxvID0gYyAlIDI1NlxuICAgIGJ5dGVBcnJheS5wdXNoKGxvKVxuICAgIGJ5dGVBcnJheS5wdXNoKGhpKVxuICB9XG5cbiAgcmV0dXJuIGJ5dGVBcnJheVxufVxuXG5mdW5jdGlvbiBiYXNlNjRUb0J5dGVzIChzdHIpIHtcbiAgcmV0dXJuIGJhc2U2NC50b0J5dGVBcnJheShiYXNlNjRjbGVhbihzdHIpKVxufVxuXG5mdW5jdGlvbiBibGl0QnVmZmVyIChzcmMsIGRzdCwgb2Zmc2V0LCBsZW5ndGgpIHtcbiAgZm9yICh2YXIgaSA9IDA7IGkgPCBsZW5ndGg7IGkrKykge1xuICAgIGlmICgoaSArIG9mZnNldCA+PSBkc3QubGVuZ3RoKSB8fCAoaSA+PSBzcmMubGVuZ3RoKSkgYnJlYWtcbiAgICBkc3RbaSArIG9mZnNldF0gPSBzcmNbaV1cbiAgfVxuICByZXR1cm4gaVxufVxuXG5mdW5jdGlvbiBkZWNvZGVVdGY4Q2hhciAoc3RyKSB7XG4gIHRyeSB7XG4gICAgcmV0dXJuIGRlY29kZVVSSUNvbXBvbmVudChzdHIpXG4gIH0gY2F0Y2ggKGVycikge1xuICAgIHJldHVybiBTdHJpbmcuZnJvbUNoYXJDb2RlKDB4RkZGRCkgLy8gVVRGIDggaW52YWxpZCBjaGFyXG4gIH1cbn1cbiIsInZhciBsb29rdXAgPSAnQUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVphYmNkZWZnaGlqa2xtbm9wcXJzdHV2d3h5ejAxMjM0NTY3ODkrLyc7XG5cbjsoZnVuY3Rpb24gKGV4cG9ydHMpIHtcblx0J3VzZSBzdHJpY3QnO1xuXG4gIHZhciBBcnIgPSAodHlwZW9mIFVpbnQ4QXJyYXkgIT09ICd1bmRlZmluZWQnKVxuICAgID8gVWludDhBcnJheVxuICAgIDogQXJyYXlcblxuXHR2YXIgUExVUyAgID0gJysnLmNoYXJDb2RlQXQoMClcblx0dmFyIFNMQVNIICA9ICcvJy5jaGFyQ29kZUF0KDApXG5cdHZhciBOVU1CRVIgPSAnMCcuY2hhckNvZGVBdCgwKVxuXHR2YXIgTE9XRVIgID0gJ2EnLmNoYXJDb2RlQXQoMClcblx0dmFyIFVQUEVSICA9ICdBJy5jaGFyQ29kZUF0KDApXG5cdHZhciBQTFVTX1VSTF9TQUZFID0gJy0nLmNoYXJDb2RlQXQoMClcblx0dmFyIFNMQVNIX1VSTF9TQUZFID0gJ18nLmNoYXJDb2RlQXQoMClcblxuXHRmdW5jdGlvbiBkZWNvZGUgKGVsdCkge1xuXHRcdHZhciBjb2RlID0gZWx0LmNoYXJDb2RlQXQoMClcblx0XHRpZiAoY29kZSA9PT0gUExVUyB8fFxuXHRcdCAgICBjb2RlID09PSBQTFVTX1VSTF9TQUZFKVxuXHRcdFx0cmV0dXJuIDYyIC8vICcrJ1xuXHRcdGlmIChjb2RlID09PSBTTEFTSCB8fFxuXHRcdCAgICBjb2RlID09PSBTTEFTSF9VUkxfU0FGRSlcblx0XHRcdHJldHVybiA2MyAvLyAnLydcblx0XHRpZiAoY29kZSA8IE5VTUJFUilcblx0XHRcdHJldHVybiAtMSAvL25vIG1hdGNoXG5cdFx0aWYgKGNvZGUgPCBOVU1CRVIgKyAxMClcblx0XHRcdHJldHVybiBjb2RlIC0gTlVNQkVSICsgMjYgKyAyNlxuXHRcdGlmIChjb2RlIDwgVVBQRVIgKyAyNilcblx0XHRcdHJldHVybiBjb2RlIC0gVVBQRVJcblx0XHRpZiAoY29kZSA8IExPV0VSICsgMjYpXG5cdFx0XHRyZXR1cm4gY29kZSAtIExPV0VSICsgMjZcblx0fVxuXG5cdGZ1bmN0aW9uIGI2NFRvQnl0ZUFycmF5IChiNjQpIHtcblx0XHR2YXIgaSwgaiwgbCwgdG1wLCBwbGFjZUhvbGRlcnMsIGFyclxuXG5cdFx0aWYgKGI2NC5sZW5ndGggJSA0ID4gMCkge1xuXHRcdFx0dGhyb3cgbmV3IEVycm9yKCdJbnZhbGlkIHN0cmluZy4gTGVuZ3RoIG11c3QgYmUgYSBtdWx0aXBsZSBvZiA0Jylcblx0XHR9XG5cblx0XHQvLyB0aGUgbnVtYmVyIG9mIGVxdWFsIHNpZ25zIChwbGFjZSBob2xkZXJzKVxuXHRcdC8vIGlmIHRoZXJlIGFyZSB0d28gcGxhY2Vob2xkZXJzLCB0aGFuIHRoZSB0d28gY2hhcmFjdGVycyBiZWZvcmUgaXRcblx0XHQvLyByZXByZXNlbnQgb25lIGJ5dGVcblx0XHQvLyBpZiB0aGVyZSBpcyBvbmx5IG9uZSwgdGhlbiB0aGUgdGhyZWUgY2hhcmFjdGVycyBiZWZvcmUgaXQgcmVwcmVzZW50IDIgYnl0ZXNcblx0XHQvLyB0aGlzIGlzIGp1c3QgYSBjaGVhcCBoYWNrIHRvIG5vdCBkbyBpbmRleE9mIHR3aWNlXG5cdFx0dmFyIGxlbiA9IGI2NC5sZW5ndGhcblx0XHRwbGFjZUhvbGRlcnMgPSAnPScgPT09IGI2NC5jaGFyQXQobGVuIC0gMikgPyAyIDogJz0nID09PSBiNjQuY2hhckF0KGxlbiAtIDEpID8gMSA6IDBcblxuXHRcdC8vIGJhc2U2NCBpcyA0LzMgKyB1cCB0byB0d28gY2hhcmFjdGVycyBvZiB0aGUgb3JpZ2luYWwgZGF0YVxuXHRcdGFyciA9IG5ldyBBcnIoYjY0Lmxlbmd0aCAqIDMgLyA0IC0gcGxhY2VIb2xkZXJzKVxuXG5cdFx0Ly8gaWYgdGhlcmUgYXJlIHBsYWNlaG9sZGVycywgb25seSBnZXQgdXAgdG8gdGhlIGxhc3QgY29tcGxldGUgNCBjaGFyc1xuXHRcdGwgPSBwbGFjZUhvbGRlcnMgPiAwID8gYjY0Lmxlbmd0aCAtIDQgOiBiNjQubGVuZ3RoXG5cblx0XHR2YXIgTCA9IDBcblxuXHRcdGZ1bmN0aW9uIHB1c2ggKHYpIHtcblx0XHRcdGFycltMKytdID0gdlxuXHRcdH1cblxuXHRcdGZvciAoaSA9IDAsIGogPSAwOyBpIDwgbDsgaSArPSA0LCBqICs9IDMpIHtcblx0XHRcdHRtcCA9IChkZWNvZGUoYjY0LmNoYXJBdChpKSkgPDwgMTgpIHwgKGRlY29kZShiNjQuY2hhckF0KGkgKyAxKSkgPDwgMTIpIHwgKGRlY29kZShiNjQuY2hhckF0KGkgKyAyKSkgPDwgNikgfCBkZWNvZGUoYjY0LmNoYXJBdChpICsgMykpXG5cdFx0XHRwdXNoKCh0bXAgJiAweEZGMDAwMCkgPj4gMTYpXG5cdFx0XHRwdXNoKCh0bXAgJiAweEZGMDApID4+IDgpXG5cdFx0XHRwdXNoKHRtcCAmIDB4RkYpXG5cdFx0fVxuXG5cdFx0aWYgKHBsYWNlSG9sZGVycyA9PT0gMikge1xuXHRcdFx0dG1wID0gKGRlY29kZShiNjQuY2hhckF0KGkpKSA8PCAyKSB8IChkZWNvZGUoYjY0LmNoYXJBdChpICsgMSkpID4+IDQpXG5cdFx0XHRwdXNoKHRtcCAmIDB4RkYpXG5cdFx0fSBlbHNlIGlmIChwbGFjZUhvbGRlcnMgPT09IDEpIHtcblx0XHRcdHRtcCA9IChkZWNvZGUoYjY0LmNoYXJBdChpKSkgPDwgMTApIHwgKGRlY29kZShiNjQuY2hhckF0KGkgKyAxKSkgPDwgNCkgfCAoZGVjb2RlKGI2NC5jaGFyQXQoaSArIDIpKSA+PiAyKVxuXHRcdFx0cHVzaCgodG1wID4+IDgpICYgMHhGRilcblx0XHRcdHB1c2godG1wICYgMHhGRilcblx0XHR9XG5cblx0XHRyZXR1cm4gYXJyXG5cdH1cblxuXHRmdW5jdGlvbiB1aW50OFRvQmFzZTY0ICh1aW50OCkge1xuXHRcdHZhciBpLFxuXHRcdFx0ZXh0cmFCeXRlcyA9IHVpbnQ4Lmxlbmd0aCAlIDMsIC8vIGlmIHdlIGhhdmUgMSBieXRlIGxlZnQsIHBhZCAyIGJ5dGVzXG5cdFx0XHRvdXRwdXQgPSBcIlwiLFxuXHRcdFx0dGVtcCwgbGVuZ3RoXG5cblx0XHRmdW5jdGlvbiBlbmNvZGUgKG51bSkge1xuXHRcdFx0cmV0dXJuIGxvb2t1cC5jaGFyQXQobnVtKVxuXHRcdH1cblxuXHRcdGZ1bmN0aW9uIHRyaXBsZXRUb0Jhc2U2NCAobnVtKSB7XG5cdFx0XHRyZXR1cm4gZW5jb2RlKG51bSA+PiAxOCAmIDB4M0YpICsgZW5jb2RlKG51bSA+PiAxMiAmIDB4M0YpICsgZW5jb2RlKG51bSA+PiA2ICYgMHgzRikgKyBlbmNvZGUobnVtICYgMHgzRilcblx0XHR9XG5cblx0XHQvLyBnbyB0aHJvdWdoIHRoZSBhcnJheSBldmVyeSB0aHJlZSBieXRlcywgd2UnbGwgZGVhbCB3aXRoIHRyYWlsaW5nIHN0dWZmIGxhdGVyXG5cdFx0Zm9yIChpID0gMCwgbGVuZ3RoID0gdWludDgubGVuZ3RoIC0gZXh0cmFCeXRlczsgaSA8IGxlbmd0aDsgaSArPSAzKSB7XG5cdFx0XHR0ZW1wID0gKHVpbnQ4W2ldIDw8IDE2KSArICh1aW50OFtpICsgMV0gPDwgOCkgKyAodWludDhbaSArIDJdKVxuXHRcdFx0b3V0cHV0ICs9IHRyaXBsZXRUb0Jhc2U2NCh0ZW1wKVxuXHRcdH1cblxuXHRcdC8vIHBhZCB0aGUgZW5kIHdpdGggemVyb3MsIGJ1dCBtYWtlIHN1cmUgdG8gbm90IGZvcmdldCB0aGUgZXh0cmEgYnl0ZXNcblx0XHRzd2l0Y2ggKGV4dHJhQnl0ZXMpIHtcblx0XHRcdGNhc2UgMTpcblx0XHRcdFx0dGVtcCA9IHVpbnQ4W3VpbnQ4Lmxlbmd0aCAtIDFdXG5cdFx0XHRcdG91dHB1dCArPSBlbmNvZGUodGVtcCA+PiAyKVxuXHRcdFx0XHRvdXRwdXQgKz0gZW5jb2RlKCh0ZW1wIDw8IDQpICYgMHgzRilcblx0XHRcdFx0b3V0cHV0ICs9ICc9PSdcblx0XHRcdFx0YnJlYWtcblx0XHRcdGNhc2UgMjpcblx0XHRcdFx0dGVtcCA9ICh1aW50OFt1aW50OC5sZW5ndGggLSAyXSA8PCA4KSArICh1aW50OFt1aW50OC5sZW5ndGggLSAxXSlcblx0XHRcdFx0b3V0cHV0ICs9IGVuY29kZSh0ZW1wID4+IDEwKVxuXHRcdFx0XHRvdXRwdXQgKz0gZW5jb2RlKCh0ZW1wID4+IDQpICYgMHgzRilcblx0XHRcdFx0b3V0cHV0ICs9IGVuY29kZSgodGVtcCA8PCAyKSAmIDB4M0YpXG5cdFx0XHRcdG91dHB1dCArPSAnPSdcblx0XHRcdFx0YnJlYWtcblx0XHR9XG5cblx0XHRyZXR1cm4gb3V0cHV0XG5cdH1cblxuXHRleHBvcnRzLnRvQnl0ZUFycmF5ID0gYjY0VG9CeXRlQXJyYXlcblx0ZXhwb3J0cy5mcm9tQnl0ZUFycmF5ID0gdWludDhUb0Jhc2U2NFxufSh0eXBlb2YgZXhwb3J0cyA9PT0gJ3VuZGVmaW5lZCcgPyAodGhpcy5iYXNlNjRqcyA9IHt9KSA6IGV4cG9ydHMpKVxuIiwiZXhwb3J0cy5yZWFkID0gZnVuY3Rpb24oYnVmZmVyLCBvZmZzZXQsIGlzTEUsIG1MZW4sIG5CeXRlcykge1xuICB2YXIgZSwgbSxcbiAgICAgIGVMZW4gPSBuQnl0ZXMgKiA4IC0gbUxlbiAtIDEsXG4gICAgICBlTWF4ID0gKDEgPDwgZUxlbikgLSAxLFxuICAgICAgZUJpYXMgPSBlTWF4ID4+IDEsXG4gICAgICBuQml0cyA9IC03LFxuICAgICAgaSA9IGlzTEUgPyAobkJ5dGVzIC0gMSkgOiAwLFxuICAgICAgZCA9IGlzTEUgPyAtMSA6IDEsXG4gICAgICBzID0gYnVmZmVyW29mZnNldCArIGldO1xuXG4gIGkgKz0gZDtcblxuICBlID0gcyAmICgoMSA8PCAoLW5CaXRzKSkgLSAxKTtcbiAgcyA+Pj0gKC1uQml0cyk7XG4gIG5CaXRzICs9IGVMZW47XG4gIGZvciAoOyBuQml0cyA+IDA7IGUgPSBlICogMjU2ICsgYnVmZmVyW29mZnNldCArIGldLCBpICs9IGQsIG5CaXRzIC09IDgpO1xuXG4gIG0gPSBlICYgKCgxIDw8ICgtbkJpdHMpKSAtIDEpO1xuICBlID4+PSAoLW5CaXRzKTtcbiAgbkJpdHMgKz0gbUxlbjtcbiAgZm9yICg7IG5CaXRzID4gMDsgbSA9IG0gKiAyNTYgKyBidWZmZXJbb2Zmc2V0ICsgaV0sIGkgKz0gZCwgbkJpdHMgLT0gOCk7XG5cbiAgaWYgKGUgPT09IDApIHtcbiAgICBlID0gMSAtIGVCaWFzO1xuICB9IGVsc2UgaWYgKGUgPT09IGVNYXgpIHtcbiAgICByZXR1cm4gbSA/IE5hTiA6ICgocyA/IC0xIDogMSkgKiBJbmZpbml0eSk7XG4gIH0gZWxzZSB7XG4gICAgbSA9IG0gKyBNYXRoLnBvdygyLCBtTGVuKTtcbiAgICBlID0gZSAtIGVCaWFzO1xuICB9XG4gIHJldHVybiAocyA/IC0xIDogMSkgKiBtICogTWF0aC5wb3coMiwgZSAtIG1MZW4pO1xufTtcblxuZXhwb3J0cy53cml0ZSA9IGZ1bmN0aW9uKGJ1ZmZlciwgdmFsdWUsIG9mZnNldCwgaXNMRSwgbUxlbiwgbkJ5dGVzKSB7XG4gIHZhciBlLCBtLCBjLFxuICAgICAgZUxlbiA9IG5CeXRlcyAqIDggLSBtTGVuIC0gMSxcbiAgICAgIGVNYXggPSAoMSA8PCBlTGVuKSAtIDEsXG4gICAgICBlQmlhcyA9IGVNYXggPj4gMSxcbiAgICAgIHJ0ID0gKG1MZW4gPT09IDIzID8gTWF0aC5wb3coMiwgLTI0KSAtIE1hdGgucG93KDIsIC03NykgOiAwKSxcbiAgICAgIGkgPSBpc0xFID8gMCA6IChuQnl0ZXMgLSAxKSxcbiAgICAgIGQgPSBpc0xFID8gMSA6IC0xLFxuICAgICAgcyA9IHZhbHVlIDwgMCB8fCAodmFsdWUgPT09IDAgJiYgMSAvIHZhbHVlIDwgMCkgPyAxIDogMDtcblxuICB2YWx1ZSA9IE1hdGguYWJzKHZhbHVlKTtcblxuICBpZiAoaXNOYU4odmFsdWUpIHx8IHZhbHVlID09PSBJbmZpbml0eSkge1xuICAgIG0gPSBpc05hTih2YWx1ZSkgPyAxIDogMDtcbiAgICBlID0gZU1heDtcbiAgfSBlbHNlIHtcbiAgICBlID0gTWF0aC5mbG9vcihNYXRoLmxvZyh2YWx1ZSkgLyBNYXRoLkxOMik7XG4gICAgaWYgKHZhbHVlICogKGMgPSBNYXRoLnBvdygyLCAtZSkpIDwgMSkge1xuICAgICAgZS0tO1xuICAgICAgYyAqPSAyO1xuICAgIH1cbiAgICBpZiAoZSArIGVCaWFzID49IDEpIHtcbiAgICAgIHZhbHVlICs9IHJ0IC8gYztcbiAgICB9IGVsc2Uge1xuICAgICAgdmFsdWUgKz0gcnQgKiBNYXRoLnBvdygyLCAxIC0gZUJpYXMpO1xuICAgIH1cbiAgICBpZiAodmFsdWUgKiBjID49IDIpIHtcbiAgICAgIGUrKztcbiAgICAgIGMgLz0gMjtcbiAgICB9XG5cbiAgICBpZiAoZSArIGVCaWFzID49IGVNYXgpIHtcbiAgICAgIG0gPSAwO1xuICAgICAgZSA9IGVNYXg7XG4gICAgfSBlbHNlIGlmIChlICsgZUJpYXMgPj0gMSkge1xuICAgICAgbSA9ICh2YWx1ZSAqIGMgLSAxKSAqIE1hdGgucG93KDIsIG1MZW4pO1xuICAgICAgZSA9IGUgKyBlQmlhcztcbiAgICB9IGVsc2Uge1xuICAgICAgbSA9IHZhbHVlICogTWF0aC5wb3coMiwgZUJpYXMgLSAxKSAqIE1hdGgucG93KDIsIG1MZW4pO1xuICAgICAgZSA9IDA7XG4gICAgfVxuICB9XG5cbiAgZm9yICg7IG1MZW4gPj0gODsgYnVmZmVyW29mZnNldCArIGldID0gbSAmIDB4ZmYsIGkgKz0gZCwgbSAvPSAyNTYsIG1MZW4gLT0gOCk7XG5cbiAgZSA9IChlIDw8IG1MZW4pIHwgbTtcbiAgZUxlbiArPSBtTGVuO1xuICBmb3IgKDsgZUxlbiA+IDA7IGJ1ZmZlcltvZmZzZXQgKyBpXSA9IGUgJiAweGZmLCBpICs9IGQsIGUgLz0gMjU2LCBlTGVuIC09IDgpO1xuXG4gIGJ1ZmZlcltvZmZzZXQgKyBpIC0gZF0gfD0gcyAqIDEyODtcbn07XG4iLCJcbi8qKlxuICogaXNBcnJheVxuICovXG5cbnZhciBpc0FycmF5ID0gQXJyYXkuaXNBcnJheTtcblxuLyoqXG4gKiB0b1N0cmluZ1xuICovXG5cbnZhciBzdHIgPSBPYmplY3QucHJvdG90eXBlLnRvU3RyaW5nO1xuXG4vKipcbiAqIFdoZXRoZXIgb3Igbm90IHRoZSBnaXZlbiBgdmFsYFxuICogaXMgYW4gYXJyYXkuXG4gKlxuICogZXhhbXBsZTpcbiAqXG4gKiAgICAgICAgaXNBcnJheShbXSk7XG4gKiAgICAgICAgLy8gPiB0cnVlXG4gKiAgICAgICAgaXNBcnJheShhcmd1bWVudHMpO1xuICogICAgICAgIC8vID4gZmFsc2VcbiAqICAgICAgICBpc0FycmF5KCcnKTtcbiAqICAgICAgICAvLyA+IGZhbHNlXG4gKlxuICogQHBhcmFtIHttaXhlZH0gdmFsXG4gKiBAcmV0dXJuIHtib29sfVxuICovXG5cbm1vZHVsZS5leHBvcnRzID0gaXNBcnJheSB8fCBmdW5jdGlvbiAodmFsKSB7XG4gIHJldHVybiAhISB2YWwgJiYgJ1tvYmplY3QgQXJyYXldJyA9PSBzdHIuY2FsbCh2YWwpO1xufTtcbiIsIi8qKlxuICogRXBpY2VudGVyIEphdmFzY3JpcHQgbGlicmFyaWVzXG4gKiB2PCU9IHZlcnNpb24gJT5cbiAqIGh0dHBzOi8vZ2l0aHViLmNvbS9mb3Jpby9lcGljZW50ZXItanMtbGlic1xuICovXG5cbnZhciBGID0ge1xuICAgIHV0aWw6IHt9LFxuICAgIGZhY3Rvcnk6IHt9LFxuICAgIHRyYW5zcG9ydDoge30sXG4gICAgc3RvcmU6IHt9LFxuICAgIHNlcnZpY2U6IHt9LFxuICAgIG1hbmFnZXI6IHtcbiAgICAgICAgc3RyYXRlZ3k6IHt9XG4gICAgfSxcblxufTtcblxuRi51dGlsLnF1ZXJ5ID0gcmVxdWlyZSgnLi91dGlsL3F1ZXJ5LXV0aWwnKTtcbkYudXRpbC5tYWtlU2VxdWVuY2UgPSByZXF1aXJlKCcuL3V0aWwvbWFrZS1zZXF1ZW5jZScpO1xuRi51dGlsLnJ1biA9IHJlcXVpcmUoJy4vdXRpbC9ydW4tdXRpbCcpO1xuRi51dGlsLmNsYXNzRnJvbSA9IHJlcXVpcmUoJy4vdXRpbC9pbmhlcml0Jyk7XG5cbkYuZmFjdG9yeS5UcmFuc3BvcnQgPSByZXF1aXJlKCcuL3RyYW5zcG9ydC9odHRwLXRyYW5zcG9ydC1mYWN0b3J5Jyk7XG5GLnRyYW5zcG9ydC5BamF4ID0gcmVxdWlyZSgnLi90cmFuc3BvcnQvYWpheC1odHRwLXRyYW5zcG9ydCcpO1xuXG5GLnNlcnZpY2UuVVJMID0gcmVxdWlyZSgnLi9zZXJ2aWNlL3VybC1jb25maWctc2VydmljZScpO1xuRi5zZXJ2aWNlLkNvbmZpZyA9IHJlcXVpcmUoJy4vc2VydmljZS9jb25maWd1cmF0aW9uLXNlcnZpY2UnKTtcbkYuc2VydmljZS5SdW4gPSByZXF1aXJlKCcuL3NlcnZpY2UvcnVuLWFwaS1zZXJ2aWNlJyk7XG5GLnNlcnZpY2UuVmFyaWFibGVzID0gcmVxdWlyZSgnLi9zZXJ2aWNlL3ZhcmlhYmxlcy1hcGktc2VydmljZScpO1xuRi5zZXJ2aWNlLkRhdGEgPSByZXF1aXJlKCcuL3NlcnZpY2UvZGF0YS1hcGktc2VydmljZScpO1xuRi5zZXJ2aWNlLkF1dGggPSByZXF1aXJlKCcuL3NlcnZpY2UvYXV0aC1hcGktc2VydmljZScpO1xuRi5zZXJ2aWNlLldvcmxkID0gcmVxdWlyZSgnLi9zZXJ2aWNlL3dvcmxkLWFwaS1hZGFwdGVyJyk7XG5GLnNlcnZpY2UuU3RhdGUgPSByZXF1aXJlKCcuL3NlcnZpY2Uvc3RhdGUtYXBpLWFkYXB0ZXInKTtcbkYuc2VydmljZS5Vc2VyID0gcmVxdWlyZSgnLi9zZXJ2aWNlL3VzZXItYXBpLWFkYXB0ZXInKTtcbkYuc2VydmljZS5NZW1iZXIgPSByZXF1aXJlKCcuL3NlcnZpY2UvbWVtYmVyLWFwaS1hZGFwdGVyJyk7XG5cbkYuc3RvcmUuQ29va2llID0gcmVxdWlyZSgnLi9zdG9yZS9jb29raWUtc3RvcmUnKTtcbkYuZmFjdG9yeS5TdG9yZSA9IHJlcXVpcmUoJy4vc3RvcmUvc3RvcmUtZmFjdG9yeScpO1xuXG5GLm1hbmFnZXIuU2NlbmFyaW9NYW5hZ2VyID0gcmVxdWlyZSgnLi9tYW5hZ2Vycy9zY2VuYXJpby1tYW5hZ2VyJyk7XG5GLm1hbmFnZXIuUnVuTWFuYWdlciA9IHJlcXVpcmUoJy4vbWFuYWdlcnMvcnVuLW1hbmFnZXInKTtcbkYubWFuYWdlci5BdXRoTWFuYWdlciA9IHJlcXVpcmUoJy4vbWFuYWdlcnMvYXV0aC1tYW5hZ2VyJyk7XG5GLm1hbmFnZXIuV29ybGRNYW5hZ2VyID0gcmVxdWlyZSgnLi9tYW5hZ2Vycy93b3JsZC1tYW5hZ2VyJyk7XG5cbkYubWFuYWdlci5zdHJhdGVneVsnYWx3YXlzLW5ldyddID0gcmVxdWlyZSgnLi9tYW5hZ2Vycy9ydW4tc3RyYXRlZ2llcy9hbHdheXMtbmV3LXN0cmF0ZWd5Jyk7XG5GLm1hbmFnZXIuc3RyYXRlZ3lbJ2NvbmRpdGlvbmFsLWNyZWF0aW9uJ10gPSByZXF1aXJlKCcuL21hbmFnZXJzL3J1bi1zdHJhdGVnaWVzL2NvbmRpdGlvbmFsLWNyZWF0aW9uLXN0cmF0ZWd5Jyk7XG5GLm1hbmFnZXIuc3RyYXRlZ3kuaWRlbnRpdHkgPSByZXF1aXJlKCcuL21hbmFnZXJzL3J1bi1zdHJhdGVnaWVzL2lkZW50aXR5LXN0cmF0ZWd5Jyk7XG5GLm1hbmFnZXIuc3RyYXRlZ3lbJ25ldy1pZi1taXNzaW5nJ10gPSByZXF1aXJlKCcuL21hbmFnZXJzL3J1bi1zdHJhdGVnaWVzL25ldy1pZi1taXNzaW5nLXN0cmF0ZWd5Jyk7XG5GLm1hbmFnZXIuc3RyYXRlZ3lbJ25ldy1pZi1taXNzaW5nJ10gPSByZXF1aXJlKCcuL21hbmFnZXJzL3J1bi1zdHJhdGVnaWVzL25ldy1pZi1taXNzaW5nLXN0cmF0ZWd5Jyk7XG5GLm1hbmFnZXIuc3RyYXRlZ3lbJ25ldy1pZi1wZXJzaXN0ZWQnXSA9IHJlcXVpcmUoJy4vbWFuYWdlcnMvcnVuLXN0cmF0ZWdpZXMvbmV3LWlmLXBlcnNpc3RlZC1zdHJhdGVneScpO1xuRi5tYW5hZ2VyLnN0cmF0ZWd5WyduZXctaWYtaW5pdGlhbGl6ZWQnXSA9IHJlcXVpcmUoJy4vbWFuYWdlcnMvcnVuLXN0cmF0ZWdpZXMvbmV3LWlmLWluaXRpYWxpemVkLXN0cmF0ZWd5Jyk7XG5cbkYubWFuYWdlci5DaGFubmVsTWFuYWdlciA9IHJlcXVpcmUoJy4vbWFuYWdlcnMvZXBpY2VudGVyLWNoYW5uZWwtbWFuYWdlcicpO1xuRi5zZXJ2aWNlLkNoYW5uZWwgPSByZXF1aXJlKCcuL3NlcnZpY2UvY2hhbm5lbC1zZXJ2aWNlJyk7XG5cbkYudmVyc2lvbiA9ICc8JT0gdmVyc2lvbiAlPic7XG53aW5kb3cuRiA9IEY7XG5cbiIsIi8qKlxuKiAjIyBBdXRob3JpemF0aW9uIE1hbmFnZXJcbipcbiogVGhlIEF1dGhvcml6YXRpb24gTWFuYWdlciBwcm92aWRlcyBhbiBlYXN5IHdheSB0byBtYW5hZ2UgdXNlciBhdXRoZW50aWNhdGlvbiAobG9nZ2luZyBpbiBhbmQgb3V0KSBhbmQgYXV0aG9yaXphdGlvbiAoa2VlcGluZyB0cmFjayBvZiB0b2tlbnMsIHNlc3Npb25zLCBhbmQgZ3JvdXBzKSBmb3IgcHJvamVjdHMuXG4qXG4qIFRoZSBBdXRob3JpemF0aW9uIE1hbmFnZXIgaXMgbW9zdCB1c2VmdWwgZm9yIFt0ZWFtIHByb2plY3RzXSguLi8uLi8uLi9nbG9zc2FyeS8jdGVhbSkgd2l0aCBhbiBhY2Nlc3MgbGV2ZWwgb2YgW0F1dGhlbnRpY2F0ZWRdKC4uLy4uLy4uL2dsb3NzYXJ5LyNhY2Nlc3MpLiBUaGVzZSBwcm9qZWN0cyBhcmUgYWNjZXNzZWQgYnkgW2VuZCB1c2Vyc10oLi4vLi4vLi4vZ2xvc3NhcnkvI3VzZXJzKSB3aG8gYXJlIG1lbWJlcnMgb2Ygb25lIG9yIG1vcmUgW2dyb3Vwc10oLi4vLi4vLi4vZ2xvc3NhcnkvI2dyb3VwcykuXG4qXG4qICMjIyNVc2luZyB0aGUgQXV0aG9yaXphdGlvbiBNYW5hZ2VyXG4qXG4qIFRvIHVzZSB0aGUgQXV0aG9yaXphdGlvbiBNYW5hZ2VyLCBpbnN0YW50aWF0ZSBpdC4gVGhlbiwgbWFrZSBjYWxscyB0byBhbnkgb2YgdGhlIG1ldGhvZHMgeW91IG5lZWQ6XG4qXG4qICAgICAgIHZhciBhdXRoTWdyID0gbmV3IEYubWFuYWdlci5BdXRoTWFuYWdlcih7XG4qICAgICAgICAgICBhY2NvdW50OiAnYWNtZS1zaW11bGF0aW9ucycsXG4qICAgICAgICAgICB1c2VyTmFtZTogJ2VuZHVzZXIxJyxcbiogICAgICAgICAgIHBhc3N3b3JkOiAncGFzc3cwcmQnXG4qICAgICAgIH0pO1xuKiAgICAgICBhdXRoTWdyLmxvZ2luKCk7XG4qICAgICAgIGF1dGhNZ3IuZ2V0Q3VycmVudFVzZXJTZXNzaW9uSW5mbygpO1xuKlxuKiBUaGUgYG9wdGlvbnNgIG9iamVjdCBwYXNzZWQgdG8gdGhlIGBGLm1hbmFnZXIuQXV0aE1hbmFnZXIoKWAgY2FsbCBjYW4gaW5jbHVkZTpcbipcbiogICAqIGBhY2NvdW50YDogVGhlIGFjY291bnQgaWQgZm9yIHRoaXMgYHVzZXJOYW1lYC4gSW4gdGhlIEVwaWNlbnRlciBVSSwgdGhpcyBpcyB0aGUgKipUZWFtIElEKiogKGZvciB0ZWFtIHByb2plY3RzKSBvciB0aGUgKipVc2VyIElEKiogKGZvciBwZXJzb25hbCBwcm9qZWN0cykuXG4qICAgKiBgdXNlck5hbWVgOiBFbWFpbCBvciB1c2VybmFtZSB0byB1c2UgZm9yIGxvZ2dpbmcgaW4uXG4qICAgKiBgcGFzc3dvcmRgOiBQYXNzd29yZCBmb3Igc3BlY2lmaWVkIGB1c2VyTmFtZWAuXG4qICAgKiBgcHJvamVjdGA6IFRoZSAqKlByb2plY3QgSUQqKiBmb3IgdGhlIHByb2plY3QgdG8gbG9nIHRoaXMgdXNlciBpbnRvLiBPcHRpb25hbC5cbiogICAqIGBncm91cGA6IE5hbWUgb2YgdGhlIGdyb3VwIHRvIHdoaWNoIGB1c2VyTmFtZWAgYmVsb25ncy4gUmVxdWlyZWQgZm9yIGVuZCB1c2VycyBpZiB0aGUgYHByb2plY3RgIGlzIHNwZWNpZmllZC5cbipcbiogSWYgeW91IHByZWZlciBzdGFydGluZyBmcm9tIGEgdGVtcGxhdGUsIHRoZSBFcGljZW50ZXIgSlMgTGlicyBbTG9naW4gQ29tcG9uZW50XSguLi8uLi8jY29tcG9uZW50cykgdXNlcyB0aGUgQXV0aG9yaXphdGlvbiBNYW5hZ2VyIGFzIHdlbGwuIFRoaXMgc2FtcGxlIEhUTUwgcGFnZSAoYW5kIGFzc29jaWF0ZWQgQ1NTIGFuZCBKUyBmaWxlcykgcHJvdmlkZXMgYSBsb2dpbiBmb3JtIGZvciB0ZWFtIG1lbWJlcnMgYW5kIGVuZCB1c2VycyBvZiB5b3VyIHByb2plY3QuIEl0IGFsc28gaW5jbHVkZXMgYSBncm91cCBzZWxlY3RvciBmb3IgZW5kIHVzZXJzIHRoYXQgYXJlIG1lbWJlcnMgb2YgbXVsdGlwbGUgZ3JvdXBzLlxuKi9cblxuJ3VzZSBzdHJpY3QnO1xudmFyIENvbmZpZ1NlcnZpY2UgPSByZXF1aXJlKCcuLi9zZXJ2aWNlL2NvbmZpZ3VyYXRpb24tc2VydmljZScpO1xudmFyIEF1dGhBZGFwdGVyID0gcmVxdWlyZSgnLi4vc2VydmljZS9hdXRoLWFwaS1zZXJ2aWNlJyk7XG52YXIgTWVtYmVyQWRhcHRlciA9IHJlcXVpcmUoJy4uL3NlcnZpY2UvbWVtYmVyLWFwaS1hZGFwdGVyJyk7XG52YXIgU3RvcmFnZUZhY3RvcnkgPSByZXF1aXJlKCcuLi9zdG9yZS9zdG9yZS1mYWN0b3J5Jyk7XG52YXIgQnVmZmVyID0gcmVxdWlyZSgnYnVmZmVyJykuQnVmZmVyO1xudmFyIGtleU5hbWVzID0gcmVxdWlyZSgnLi9rZXktbmFtZXMnKTtcblxudmFyIGRlZmF1bHRzID0ge1xuICAgIC8qKlxuICAgICAqIFdoZXJlIHRvIHN0b3JlIHVzZXIgYWNjZXNzIHRva2VucyBmb3IgdGVtcG9yYXJ5IGFjY2Vzcy4gRGVmYXVsdHMgdG8gc3RvcmluZyBpbiBhIGNvb2tpZSBpbiB0aGUgYnJvd3Nlci5cbiAgICAgKiBAdHlwZSB7c3RyaW5nfVxuICAgICAqL1xuICAgIHN0b3JlOiB7IHN5bmNocm9ub3VzOiB0cnVlIH1cbn07XG5cbnZhciBFUElfQ09PS0lFX0tFWSA9IGtleU5hbWVzLkVQSV9DT09LSUVfS0VZO1xudmFyIEVQSV9TRVNTSU9OX0tFWSA9IGtleU5hbWVzLkVQSV9TRVNTSU9OX0tFWTtcbnZhciBzdG9yZTtcbnZhciB0b2tlbjtcbnZhciBzZXNzaW9uO1xuXG5mdW5jdGlvbiBzYXZlU2Vzc2lvbih1c2VySW5mbykge1xuICAgIHZhciBzZXJpYWxpemVkID0gSlNPTi5zdHJpbmdpZnkodXNlckluZm8pO1xuICAgIHN0b3JlLnNldChFUElfU0VTU0lPTl9LRVksIHNlcmlhbGl6ZWQpO1xuXG4gICAgLy9qc2hpbnQgY2FtZWxjYXNlOiBmYWxzZVxuICAgIC8vanNjczpkaXNhYmxlXG4gICAgc3RvcmUuc2V0KEVQSV9DT09LSUVfS0VZLCB1c2VySW5mby5hdXRoX3Rva2VuKTtcbn1cblxuZnVuY3Rpb24gZ2V0U2Vzc2lvbigpIHtcbiAgICB2YXIgc2Vzc2lvbiA9IHN0b3JlLmdldChFUElfU0VTU0lPTl9LRVkpIHx8ICd7fSc7XG4gICAgcmV0dXJuIEpTT04ucGFyc2Uoc2Vzc2lvbik7XG59XG5cbmZ1bmN0aW9uIEF1dGhNYW5hZ2VyKG9wdGlvbnMpIHtcbiAgICB0aGlzLm9wdGlvbnMgPSAkLmV4dGVuZCh0cnVlLCB7fSwgZGVmYXVsdHMsIG9wdGlvbnMpO1xuXG4gICAgdmFyIHVybENvbmZpZyA9IG5ldyBDb25maWdTZXJ2aWNlKHRoaXMub3B0aW9ucykuZ2V0KCdzZXJ2ZXInKTtcbiAgICBpZiAoIXRoaXMub3B0aW9ucy5hY2NvdW50KSB7XG4gICAgICAgIHRoaXMub3B0aW9ucy5hY2NvdW50ID0gdXJsQ29uZmlnLmFjY291bnRQYXRoO1xuICAgIH1cblxuICAgIC8vIG51bGwgbWlnaHQgc3BlY2lmaWVkIHRvIGRpc2FibGUgcHJvamVjdCBmaWx0ZXJpbmdcbiAgICBpZiAodGhpcy5vcHRpb25zLnByb2plY3QgPT09IHVuZGVmaW5lZCkge1xuICAgICAgICB0aGlzLm9wdGlvbnMucHJvamVjdCA9IHVybENvbmZpZy5wcm9qZWN0UGF0aDtcbiAgICB9XG5cbiAgICBzdG9yZSA9IG5ldyBTdG9yYWdlRmFjdG9yeSh0aGlzLm9wdGlvbnMuc3RvcmUpO1xuICAgIHNlc3Npb24gPSBnZXRTZXNzaW9uKCk7XG4gICAgdG9rZW4gPSBzdG9yZS5nZXQoRVBJX0NPT0tJRV9LRVkpIHx8ICcnO1xuICAgIC8vanNoaW50IGNhbWVsY2FzZTogZmFsc2VcbiAgICAvL2pzY3M6ZGlzYWJsZVxuICAgIHRoaXMuYXV0aEFkYXB0ZXIgPSBuZXcgQXV0aEFkYXB0ZXIodGhpcy5vcHRpb25zLCB7IHRva2VuOiBzZXNzaW9uLmF1dGhfdG9rZW4gfSk7XG59XG5cbnZhciBfZmluZFVzZXJJbkdyb3VwID0gZnVuY3Rpb24gKG1lbWJlcnMsIGlkKSB7XG4gICAgZm9yICh2YXIgaiA9IDA7IGo8bWVtYmVycy5sZW5ndGg7IGorKykge1xuICAgICAgICBpZiAobWVtYmVyc1tqXS51c2VySWQgPT09IGlkKSB7XG4gICAgICAgICAgICByZXR1cm4gbWVtYmVyc1tqXTtcbiAgICAgICAgfVxuICAgIH1cblxuXG4gICAgcmV0dXJuIG51bGw7XG59O1xuXG5BdXRoTWFuYWdlci5wcm90b3R5cGUgPSAkLmV4dGVuZChBdXRoTWFuYWdlci5wcm90b3R5cGUsIHtcblxuICAgIC8qKlxuICAgICogTG9ncyB1c2VyIGluLlxuICAgICpcbiAgICAqICoqRXhhbXBsZSoqXG4gICAgKlxuICAgICogICAgICAgYXV0aE1nci5sb2dpbih7XG4gICAgKiAgICAgICAgICAgYWNjb3VudDogJ2FjbWUtc2ltdWxhdGlvbnMnLCBcbiAgICAqICAgICAgICAgICB1c2VyTmFtZTogJ2VuZHVzZXIxJywgXG4gICAgKiAgICAgICAgICAgcGFzc3dvcmQ6ICdwYXNzdzByZCcgXG4gICAgKiAgICAgICB9KTtcbiAgICAqXG4gICAgKiAgICAgICBhdXRoTWdyLmxvZ2luKClcbiAgICAqICAgICAgICAgICAudGhlbihmdW5jdGlvbihhdXRoQWRhcHRlcikge1xuICAgICogICAgICAgICAgICAgICAvLyBpZiBlbmR1c2VyMSBiZWxvbmdzIHRvIGV4YWN0bHkgb25lIGdyb3VwXG4gICAgKiAgICAgICAgICAgICAgIC8vIChvciBpZiB0aGUgbG9naW4oKSBjYWxsIGlzIG1vZGlmaWVkIHRvIGluY2x1ZGUgdGhlIGdyb3VwKVxuICAgICogICAgICAgICAgICAgICAvLyBjb250aW51ZSBoZXJlXG4gICAgKiAgICAgICAgICAgfSlcbiAgICAqICAgICAgICAgICAuZmFpbChmdW5jdGlvbihhdXRoQWRhcHRlcikge1xuICAgICogICAgICAgICAgICAgICAvLyBpZiBlbmR1c2VyMSBiZWxvbmdzIHRvIG11bHRpcGxlIGdyb3VwcywgXG4gICAgKiAgICAgICAgICAgICAgIC8vIHRoZSBsb2dpbigpIGNhbGwgZmFpbHMgXG4gICAgKiAgICAgICAgICAgICAgIC8vIGFuZCByZXR1cm5zIGFsbCBncm91cHMgb2Ygd2hpY2ggdGhlIHVzZXIgaXMgYSBtZW1iZXJcbiAgICAqICAgICAgICAgICB9KTtcbiAgICAqXG4gICAgKiAqKlBhcmFtZXRlcnMqKlxuICAgICpcbiAgICAqIEBwYXJhbSB7T2JqZWN0fSBgb3B0aW9uc2AgKE9wdGlvbmFsKSBPdmVycmlkZXMgZm9yIGNvbmZpZ3VyYXRpb24gb3B0aW9ucy4gSWYgbm90IHBhc3NlZCBpbiB3aGVuIGNyZWF0aW5nIGFuIGluc3RhbmNlIG9mIHRoZSBtYW5hZ2VyIChgRi5tYW5hZ2VyLkF1dGhNYW5hZ2VyKClgKSwgdGhlc2Ugb3B0aW9ucyBzaG91bGQgaW5jbHVkZTogXG4gICAgKiBAcGFyYW0ge3N0cmluZ30gYG9wdGlvbnMuYWNjb3VudGAgVGhlIGFjY291bnQgaWQgZm9yIHRoaXMgYHVzZXJOYW1lYC4gSW4gdGhlIEVwaWNlbnRlciBVSSwgdGhpcyBpcyB0aGUgKipUZWFtIElEKiogKGZvciB0ZWFtIHByb2plY3RzKSBvciB0aGUgKipVc2VyIElEKiogKGZvciBwZXJzb25hbCBwcm9qZWN0cykuXG4gICAgKiBAcGFyYW0ge3N0cmluZ30gYG9wdGlvbnMudXNlck5hbWVgIEVtYWlsIG9yIHVzZXJuYW1lIHRvIHVzZSBmb3IgbG9nZ2luZyBpbi5cbiAgICAqIEBwYXJhbSB7c3RyaW5nfSBgb3B0aW9ucy5wYXNzd29yZGAgUGFzc3dvcmQgZm9yIHNwZWNpZmllZCBgdXNlck5hbWVgLlxuICAgICogQHBhcmFtIHtzdHJpbmd9IGBvcHRpb25zLnByb2plY3RgIChPcHRpb25hbCkgVGhlICoqUHJvamVjdCBJRCoqIGZvciB0aGUgcHJvamVjdCB0byBsb2cgdGhpcyB1c2VyIGludG8uXG4gICAgKiBAcGFyYW0ge3N0cmluZ30gYG9wdGlvbnMuZ3JvdXBgIE5hbWUgb2YgdGhlIGdyb3VwIHRvIHdoaWNoIGB1c2VyTmFtZWAgYmVsb25ncy4gUmVxdWlyZWQgZm9yIFtlbmQgdXNlcnNdKC4uLy4uLy4uL2dsb3NzYXJ5LyN1c2VycykgaWYgdGhlIGBwcm9qZWN0YCBpcyBzcGVjaWZpZWQsIGFuZCBmb3IgZW5kIHVzZXJzIHRoYXQgYXJlIG1lbWJlcnMgb2YgbXVsdGlwbGUgW2dyb3Vwc10oLi4vLi4vLi4vZ2xvc3NhcnkvI2dyb3VwcyksIG90aGVyd2lzZSBvcHRpb25hbC5cbiAgICAqL1xuICAgIGxvZ2luOiBmdW5jdGlvbiAob3B0aW9ucykge1xuICAgICAgICB2YXIgX3RoaXMgPSB0aGlzO1xuICAgICAgICB2YXIgJGQgPSAkLkRlZmVycmVkKCk7XG4gICAgICAgIHZhciBhZGFwdGVyT3B0aW9ucyA9ICQuZXh0ZW5kKHRydWUsIHsgc3VjY2VzczogJC5ub29wLCBlcnJvcjogJC5ub29wIH0sIHRoaXMub3B0aW9ucywgb3B0aW9ucyk7XG4gICAgICAgIHZhciBvdXRTdWNjZXNzID0gYWRhcHRlck9wdGlvbnMuc3VjY2VzcztcbiAgICAgICAgdmFyIG91dEVycm9yID0gYWRhcHRlck9wdGlvbnMuZXJyb3I7XG4gICAgICAgIHZhciBncm91cElkID0gYWRhcHRlck9wdGlvbnMuZ3JvdXBJZDtcblxuICAgICAgICB2YXIgZGVjb2RlVG9rZW4gPSBmdW5jdGlvbiAodG9rZW4pIHtcbiAgICAgICAgICAgIHZhciBlbmNvZGVkID0gdG9rZW4uc3BsaXQoJy4nKVsxXTtcbiAgICAgICAgICAgIHdoaWxlIChlbmNvZGVkLmxlbmd0aCAlIDQgIT09IDApIHtcbiAgICAgICAgICAgICAgICBlbmNvZGVkICs9ICc9JztcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgdmFyIGRlY29kZSA9IHdpbmRvdy5hdG9iID8gd2luZG93LmF0b2IgOiBmdW5jdGlvbiAoZW5jb2RlZCkgeyByZXR1cm4gbmV3IEJ1ZmZlcihlbmNvZGVkLCAnYmFzZTY0JykudG9TdHJpbmcoJ2FzY2lpJyk7IH07XG5cbiAgICAgICAgICAgIHJldHVybiBKU09OLnBhcnNlKGRlY29kZShlbmNvZGVkKSk7XG4gICAgICAgIH07XG5cbiAgICAgICAgdmFyIGhhbmRsZUdyb3VwRXJyb3IgPSBmdW5jdGlvbiAobWVzc2FnZSwgc3RhdHVzQ29kZSwgZGF0YSkge1xuICAgICAgICAgICAgLy8gbG9nb3V0IHRoZSB1c2VyIHNpbmNlIGl0J3MgaW4gYW4gaW52YWxpZCBzdGF0ZSB3aXRoIG5vIGdyb3VwIHNlbGVjdGVkXG4gICAgICAgICAgICBfdGhpcy5sb2dvdXQoKS50aGVuKGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgICAgICB2YXIgZXJyb3IgPSAkLmV4dGVuZCh0cnVlLCB7fSwgZGF0YSwgeyBzdGF0dXNUZXh0OiBtZXNzYWdlLCBzdGF0dXM6IHN0YXR1c0NvZGUgfSk7XG4gICAgICAgICAgICAgICAgJGQucmVqZWN0KGVycm9yKTtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9O1xuXG4gICAgICAgIHZhciBoYW5kbGVTdWNjZXNzID0gZnVuY3Rpb24gKHJlc3BvbnNlKSB7XG4gICAgICAgICAgICAvL2pzaGludCBjYW1lbGNhc2U6IGZhbHNlXG4gICAgICAgICAgICAvL2pzY3M6ZGlzYWJsZVxuICAgICAgICAgICAgdG9rZW4gPSByZXNwb25zZS5hY2Nlc3NfdG9rZW47XG5cbiAgICAgICAgICAgIHZhciB1c2VySW5mbyA9IGRlY29kZVRva2VuKHRva2VuKTtcbiAgICAgICAgICAgIHZhciB1c2VyR3JvdXBPcHRzID0gJC5leHRlbmQodHJ1ZSwge30sIGFkYXB0ZXJPcHRpb25zLCB7IHN1Y2Nlc3M6ICQubm9vcCwgdG9rZW46IHRva2VuIH0pO1xuICAgICAgICAgICAgX3RoaXMuZ2V0VXNlckdyb3Vwcyh7IHVzZXJJZDogdXNlckluZm8udXNlcl9pZCwgdG9rZW46IHRva2VuIH0sIHVzZXJHcm91cE9wdHMpLmRvbmUoIGZ1bmN0aW9uIChtZW1iZXJJbmZvKSB7XG4gICAgICAgICAgICAgICAgdmFyIGRhdGEgPSB7YXV0aDogcmVzcG9uc2UsIHVzZXI6IHVzZXJJbmZvLCB1c2VyR3JvdXBzOiBtZW1iZXJJbmZvLCBncm91cFNlbGVjdGlvbjoge30gfTtcblxuICAgICAgICAgICAgICAgIHZhciBzZXNzaW9uSW5mbyA9IHtcbiAgICAgICAgICAgICAgICAgICAgJ2F1dGhfdG9rZW4nOiB0b2tlbixcbiAgICAgICAgICAgICAgICAgICAgJ2FjY291bnQnOiBhZGFwdGVyT3B0aW9ucy5hY2NvdW50LFxuICAgICAgICAgICAgICAgICAgICAncHJvamVjdCc6IGFkYXB0ZXJPcHRpb25zLnByb2plY3QsXG4gICAgICAgICAgICAgICAgICAgICd1c2VySWQnOiB1c2VySW5mby51c2VyX2lkXG4gICAgICAgICAgICAgICAgfTtcbiAgICAgICAgICAgICAgICAvLyBUaGUgZ3JvdXAgaXMgbm90IHJlcXVpcmVkIGlmIHRoZSB1c2VyIGlzIG5vdCBsb2dnaW5nIGludG8gYSBwcm9qZWN0XG4gICAgICAgICAgICAgICAgaWYgKCFhZGFwdGVyT3B0aW9ucy5wcm9qZWN0KSB7XG4gICAgICAgICAgICAgICAgICAgIHNhdmVTZXNzaW9uKHNlc3Npb25JbmZvKTtcbiAgICAgICAgICAgICAgICAgICAgb3V0U3VjY2Vzcy5hcHBseSh0aGlzLCBbZGF0YV0pO1xuICAgICAgICAgICAgICAgICAgICAkZC5yZXNvbHZlKGRhdGEpO1xuICAgICAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgdmFyIGdyb3VwID0gbnVsbDtcbiAgICAgICAgICAgICAgICBpZiAobWVtYmVySW5mby5sZW5ndGggPT09IDApIHtcbiAgICAgICAgICAgICAgICAgICAgaGFuZGxlR3JvdXBFcnJvcignVGhlIHVzZXIgaGFzIG5vIGdyb3VwcyBhc3NvY2lhdGVkIGluIHRoaXMgYWNjb3VudCcsIDQwMSwgZGF0YSk7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgICAgICB9IGVsc2UgaWYgKG1lbWJlckluZm8ubGVuZ3RoID09PSAxKSB7XG4gICAgICAgICAgICAgICAgICAgIC8vIFNlbGVjdCB0aGUgb25seSBncm91cFxuICAgICAgICAgICAgICAgICAgICBncm91cCA9IG1lbWJlckluZm9bMF07XG4gICAgICAgICAgICAgICAgfSBlbHNlIGlmIChtZW1iZXJJbmZvLmxlbmd0aCA+IDEpIHtcbiAgICAgICAgICAgICAgICAgICAgaWYgKGdyb3VwSWQpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHZhciBmaWx0ZXJlZEdyb3VwcyA9ICQuZ3JlcChtZW1iZXJJbmZvLCBmdW5jdGlvbiAocmVzR3JvdXApIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4gcmVzR3JvdXAuZ3JvdXBJZCA9PT0gZ3JvdXBJZDtcbiAgICAgICAgICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICAgICAgICAgICAgZ3JvdXAgPSBmaWx0ZXJlZEdyb3Vwcy5sZW5ndGggPT09IDEgPyBmaWx0ZXJlZEdyb3Vwc1swXSA6IG51bGw7XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICBpZiAoZ3JvdXApIHtcbiAgICAgICAgICAgICAgICAgICAgdmFyIGdyb3VwU2VsZWN0aW9uID0gZ3JvdXAuZ3JvdXBJZDtcbiAgICAgICAgICAgICAgICAgICAgZGF0YS5ncm91cFNlbGVjdGlvblthZGFwdGVyT3B0aW9ucy5wcm9qZWN0XSA9IGdyb3VwU2VsZWN0aW9uO1xuICAgICAgICAgICAgICAgICAgICB2YXIgc2Vzc2lvbkluZm9XaXRoR3JvdXAgPSAkLmV4dGVuZCh7fSwgc2Vzc2lvbkluZm8sIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICdncm91cElkJzogZ3JvdXAuZ3JvdXBJZCxcbiAgICAgICAgICAgICAgICAgICAgICAgICdncm91cE5hbWUnOiBncm91cC5uYW1lLFxuICAgICAgICAgICAgICAgICAgICAgICAgJ2lzRmFjJzogX2ZpbmRVc2VySW5Hcm91cChncm91cC5tZW1iZXJzLCB1c2VySW5mby51c2VyX2lkKS5yb2xlID09PSAnZmFjaWxpdGF0b3InXG4gICAgICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICAgICAgICBzYXZlU2Vzc2lvbihzZXNzaW9uSW5mb1dpdGhHcm91cCk7XG4gICAgICAgICAgICAgICAgICAgIG91dFN1Y2Nlc3MuYXBwbHkodGhpcywgW2RhdGFdKTtcbiAgICAgICAgICAgICAgICAgICAgJGQucmVzb2x2ZShkYXRhKTtcbiAgICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICBoYW5kbGVHcm91cEVycm9yKCdUaGlzIGFjY291bnQgaXMgYXNzb2NpYXRlZCB3aXRoIG1vcmUgdGhhdCBvbmUgZ3JvdXAuIFBsZWFzZSBzcGVjaWZ5IGEgZ3JvdXAgaWQgdG8gbG9nIGludG8gYW5kIHRyeSBhZ2FpbicsIDQwMywgZGF0YSk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSkuZmFpbCgkZC5yZWplY3QpO1xuICAgICAgICB9O1xuXG4gICAgICAgIGFkYXB0ZXJPcHRpb25zLnN1Y2Nlc3MgPSBoYW5kbGVTdWNjZXNzO1xuICAgICAgICBhZGFwdGVyT3B0aW9ucy5lcnJvciA9IGZ1bmN0aW9uIChyZXNwb25zZSkge1xuICAgICAgICAgICAgaWYgKGFkYXB0ZXJPcHRpb25zLmFjY291bnQpIHtcbiAgICAgICAgICAgICAgICAvLyBUcnkgdG8gbG9naW4gYXMgYSBzeXN0ZW0gdXNlclxuICAgICAgICAgICAgICAgIGFkYXB0ZXJPcHRpb25zLmFjY291bnQgPSBudWxsO1xuICAgICAgICAgICAgICAgIGFkYXB0ZXJPcHRpb25zLmVycm9yID0gZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgICAgICAgICBvdXRFcnJvci5hcHBseSh0aGlzLCBhcmd1bWVudHMpO1xuICAgICAgICAgICAgICAgICAgICAkZC5yZWplY3QocmVzcG9uc2UpO1xuICAgICAgICAgICAgICAgIH07XG5cbiAgICAgICAgICAgICAgICBfdGhpcy5hdXRoQWRhcHRlci5sb2dpbihhZGFwdGVyT3B0aW9ucyk7XG4gICAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBvdXRFcnJvci5hcHBseSh0aGlzLCBhcmd1bWVudHMpO1xuICAgICAgICAgICAgJGQucmVqZWN0KHJlc3BvbnNlKTtcbiAgICAgICAgfTtcblxuICAgICAgICB0aGlzLmF1dGhBZGFwdGVyLmxvZ2luKGFkYXB0ZXJPcHRpb25zKTtcbiAgICAgICAgcmV0dXJuICRkLnByb21pc2UoKTtcbiAgICB9LFxuXG4gICAgLyoqXG4gICAgKiBMb2dzIHVzZXIgb3V0LlxuICAgICpcbiAgICAqICoqRXhhbXBsZSoqXG4gICAgKlxuICAgICogICAgICAgYXV0aE1nci5sb2dvdXQoKTtcbiAgICAqXG4gICAgKiAqKlBhcmFtZXRlcnMqKlxuICAgICpcbiAgICAqIEBwYXJhbSB7T2JqZWN0fSBgb3B0aW9uc2AgKE9wdGlvbmFsKSBPdmVycmlkZXMgZm9yIGNvbmZpZ3VyYXRpb24gb3B0aW9ucy5cbiAgICAqL1xuICAgIGxvZ291dDogZnVuY3Rpb24gKG9wdGlvbnMpIHtcbiAgICAgICAgdmFyICRkID0gJC5EZWZlcnJlZCgpO1xuICAgICAgICB2YXIgYWRhcHRlck9wdGlvbnMgPSAkLmV4dGVuZCh0cnVlLCB7c3VjY2VzczogJC5ub29wLCB0b2tlbjogdG9rZW4gfSwgdGhpcy5vcHRpb25zLCBvcHRpb25zKTtcblxuICAgICAgICB2YXIgcmVtb3ZlQ29va2llRm4gPSBmdW5jdGlvbiAocmVzcG9uc2UpIHtcbiAgICAgICAgICAgIHN0b3JlLnJlbW92ZShFUElfQ09PS0lFX0tFWSwgYWRhcHRlck9wdGlvbnMpO1xuICAgICAgICAgICAgc3RvcmUucmVtb3ZlKEVQSV9TRVNTSU9OX0tFWSwgYWRhcHRlck9wdGlvbnMpO1xuICAgICAgICAgICAgdG9rZW4gPSAnJztcbiAgICAgICAgfTtcblxuICAgICAgICB2YXIgb3V0U3VjY2VzcyA9IGFkYXB0ZXJPcHRpb25zLnN1Y2Nlc3M7XG4gICAgICAgIGFkYXB0ZXJPcHRpb25zLnN1Y2Nlc3MgPSBmdW5jdGlvbiAocmVzcG9uc2UpIHtcbiAgICAgICAgICAgIHJlbW92ZUNvb2tpZUZuKHJlc3BvbnNlKTtcbiAgICAgICAgICAgIG91dFN1Y2Nlc3MuYXBwbHkodGhpcywgYXJndW1lbnRzKTtcbiAgICAgICAgfTtcblxuICAgICAgICAvLyBFcGljZW50ZXIgcmV0dXJucyBhIGJhZCByZXF1ZXN0IHdoZW4gdHJ5aW5nIHRvIGRlbGV0ZSBhIHRva2VuLiBJdCBzZWVtcyBsaWtlIHRoZSBBUEkgY2FsbCBpcyBub3QgaW1wbGVtZW50ZWQgeWV0XG4gICAgICAgIC8vIE9uY2UgaXQncyBpbXBsZW1lbnRlZCB0aGlzIGVycm9yIGhhbmRsZXIgc2hvdWxkIG5vdCBiZSBuZWNlc3NhcnkuXG4gICAgICAgIGFkYXB0ZXJPcHRpb25zLmVycm9yID0gZnVuY3Rpb24gKHJlc3BvbnNlKSB7XG4gICAgICAgICAgICByZW1vdmVDb29raWVGbihyZXNwb25zZSk7XG4gICAgICAgICAgICBvdXRTdWNjZXNzLmFwcGx5KHRoaXMsIGFyZ3VtZW50cyk7XG4gICAgICAgICAgICAkZC5yZXNvbHZlKCk7XG4gICAgICAgIH07XG5cbiAgICAgICAgdGhpcy5hdXRoQWRhcHRlci5sb2dvdXQoYWRhcHRlck9wdGlvbnMpLmRvbmUoJGQucmVzb2x2ZSk7XG4gICAgICAgIHJldHVybiAkZC5wcm9taXNlKCk7XG4gICAgfSxcblxuICAgIC8qKlxuICAgICAqIFJldHVybnMgdGhlIGV4aXN0aW5nIHVzZXIgYWNjZXNzIHRva2VuIGlmIHRoZSB1c2VyIGlzIGFscmVhZHkgbG9nZ2VkIGluLiBPdGhlcndpc2UsIGxvZ3MgdGhlIHVzZXIgaW4sIGNyZWF0aW5nIGEgbmV3IHVzZXIgYWNjZXNzIHRva2VuLCBhbmQgcmV0dXJucyB0aGUgbmV3IHRva2VuLiAoU2VlIFttb3JlIGJhY2tncm91bmQgb24gYWNjZXNzIHRva2Vuc10oLi4vLi4vLi4vcHJvamVjdF9hY2Nlc3MvKSkuXG4gICAgICpcbiAgICAgKiAqKkV4YW1wbGUqKlxuICAgICAqXG4gICAgICogICAgICBhdXRoTWdyLmdldFRva2VuKClcbiAgICAgKiAgICAgICAgICAudGhlbihmdW5jdGlvbiAodG9rZW4pIHsgXG4gICAgICogICAgICAgICAgICAgIGNvbnNvbGUubG9nKCdNeSB0b2tlbiBpcyAnLCB0b2tlbik7IFxuICAgICAqICAgICAgICAgIH0pO1xuICAgICAqXG4gICAgICogKipQYXJhbWV0ZXJzKipcbiAgICAgKiBAcGFyYW0ge09iamVjdH0gYG9wdGlvbnNgIChPcHRpb25hbCkgT3ZlcnJpZGVzIGZvciBjb25maWd1cmF0aW9uIG9wdGlvbnMuXG4gICAgICovXG4gICAgZ2V0VG9rZW46IGZ1bmN0aW9uIChvcHRpb25zKSB7XG4gICAgICAgIHZhciBodHRwT3B0aW9ucyA9ICQuZXh0ZW5kKHRydWUsIHRoaXMub3B0aW9ucywgb3B0aW9ucyk7XG5cbiAgICAgICAgdmFyICRkID0gJC5EZWZlcnJlZCgpO1xuICAgICAgICBpZiAodG9rZW4pIHtcbiAgICAgICAgICAgICRkLnJlc29sdmUodG9rZW4pO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgdGhpcy5sb2dpbihodHRwT3B0aW9ucykudGhlbigkZC5yZXNvbHZlKTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gJGQucHJvbWlzZSgpO1xuICAgIH0sXG5cbiAgICAvKipcbiAgICAgKiBSZXR1cm5zIGFuIGFycmF5IG9mIGdyb3VwIHJlY29yZHMsIG9uZSBmb3IgZWFjaCBncm91cCBvZiB3aGljaCB0aGUgY3VycmVudCB1c2VyIGlzIGEgbWVtYmVyLiBFYWNoIGdyb3VwIHJlY29yZCBpbmNsdWRlcyB0aGUgZ3JvdXAgYG5hbWVgLCBgYWNjb3VudGAsIGBwcm9qZWN0YCwgYW5kIGBncm91cElkYC5cbiAgICAgKlxuICAgICAqIElmIHNvbWUgZW5kIHVzZXJzIGluIHlvdXIgcHJvamVjdCBhcmUgbWVtYmVycyBvZiBtdWx0aXBsZSBncm91cHMsIHRoaXMgaXMgYSB1c2VmdWwgbWV0aG9kIHRvIGNhbGwgb24geW91ciBwcm9qZWN0J3MgbG9naW4gcGFnZS4gV2hlbiB0aGUgdXNlciBhdHRlbXB0cyB0byBsb2cgaW4sIHlvdSBjYW4gdXNlIHRoaXMgdG8gZGlzcGxheSB0aGUgZ3JvdXBzIG9mIHdoaWNoIHRoZSB1c2VyIGlzIG1lbWJlciwgYW5kIGhhdmUgdGhlIHVzZXIgc2VsZWN0IHRoZSBjb3JyZWN0IGdyb3VwIHRvIGxvZyBpbiB0byBmb3IgdGhpcyBzZXNzaW9uLlxuICAgICAqXG4gICAgICogKipFeGFtcGxlKipcbiAgICAgKlxuICAgICAqICAgICAgLy8gZ2V0IGdyb3VwcyBmb3IgY3VycmVudCB1c2VyXG4gICAgICogICAgICBhdXRoTWdyLmdldFVzZXJHcm91cHMoKVxuICAgICAqICAgICAgICAgIC50aGVuKGZ1bmN0aW9uIChncm91cHMpIHsgXG4gICAgICogICAgICAgICAgICAgIGZvciAodmFyIGk9MDsgaSA8IGdyb3Vwcy5sZW5ndGg7IGkrKykgXG4gICAgICogICAgICAgICAgICAgICAgICB7IGNvbnNvbGUubG9nKGdyb3Vwc1tpXS5uYW1lKTsgfVxuICAgICAqICAgICAgICAgIH0pO1xuICAgICAqXG4gICAgICogICAgICAvLyBnZXQgZ3JvdXBzIGZvciBwYXJ0aWN1bGFyIHVzZXJcbiAgICAgKiAgICAgIGF1dGhNZ3IuZ2V0VXNlckdyb3Vwcyh7dXNlcklkOiAnYjFjMTlkZGEtMmQyZS00Nzc3LWFkNWQtMzkyOWYxN2U4NmQzJ30pO1xuICAgICAqXG4gICAgICogKipQYXJhbWV0ZXJzKipcbiAgICAgKiBAcGFyYW0ge09iamVjdH0gYHBhcmFtc2AgKE9wdGlvbmFsKSBPYmplY3Qgd2l0aCBhIHVzZXJJZCBhbmQgdG9rZW4gcHJvcGVydGllcy5cbiAgICAgKiBAcGFyYW0ge09iamVjdH0gYG9wdGlvbnNgIChPcHRpb25hbCkgT3ZlcnJpZGVzIGZvciBjb25maWd1cmF0aW9uIG9wdGlvbnMuXG4gICAgICovXG4gICAgZ2V0VXNlckdyb3VwczogZnVuY3Rpb24gKHBhcmFtcywgb3B0aW9ucykge1xuICAgICAgICB2YXIgYWRhcHRlck9wdGlvbnMgPSAkLmV4dGVuZCh0cnVlLCB7IHN1Y2Nlc3M6ICQubm9vcCB9LCB0aGlzLm9wdGlvbnMsIG9wdGlvbnMpO1xuICAgICAgICB2YXIgJGQgPSAkLkRlZmVycmVkKCk7XG4gICAgICAgIHZhciBvdXRTdWNjZXNzID0gYWRhcHRlck9wdGlvbnMuc3VjY2VzcztcblxuICAgICAgICBhZGFwdGVyT3B0aW9ucy5zdWNjZXNzID0gZnVuY3Rpb24gKG1lbWJlckluZm8pIHtcbiAgICAgICAgICAgIC8vIFRoZSBtZW1iZXIgQVBJIGlzIGF0IHRoZSBhY2NvdW50IHNjb3BlLCB3ZSBmaWx0ZXIgYnkgcHJvamVjdFxuICAgICAgICAgICAgaWYgKGFkYXB0ZXJPcHRpb25zLnByb2plY3QpIHtcbiAgICAgICAgICAgICAgICBtZW1iZXJJbmZvID0gJC5ncmVwKG1lbWJlckluZm8sIGZ1bmN0aW9uIChncm91cCkge1xuICAgICAgICAgICAgICAgICAgICByZXR1cm4gZ3JvdXAucHJvamVjdCA9PT0gYWRhcHRlck9wdGlvbnMucHJvamVjdDtcbiAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgb3V0U3VjY2Vzcy5hcHBseSh0aGlzLCBbbWVtYmVySW5mb10pO1xuICAgICAgICAgICAgJGQucmVzb2x2ZShtZW1iZXJJbmZvKTtcbiAgICAgICAgfTtcblxuICAgICAgICB2YXIgbWVtYmVyQWRhcHRlciA9IG5ldyBNZW1iZXJBZGFwdGVyKHsgdG9rZW46IHBhcmFtcy50b2tlbiB9KTtcbiAgICAgICAgbWVtYmVyQWRhcHRlci5nZXRHcm91cHNCeVVzZXIocGFyYW1zLCBhZGFwdGVyT3B0aW9ucykuZmFpbCgkZC5yZWplY3QpO1xuICAgICAgICByZXR1cm4gJGQucHJvbWlzZSgpO1xuICAgIH0sXG5cbiAgICAvKipcbiAgICAgKiBSZXR1cm5zIHNlc3Npb24gaW5mb3JtYXRpb24gZm9yIHRoZSBjdXJyZW50IHVzZXIsIGluY2x1ZGluZyB0aGUgYHVzZXJJZGAsIGBhY2NvdW50YCwgYHByb2plY3RgLCBgZ3JvdXBJZGAsIGBncm91cE5hbWVgLCBgaXNGYWNgICh3aGV0aGVyIHRoZSBlbmQgdXNlciBpcyBhIGZhY2lsaXRhdG9yIG9mIHRoaXMgZ3JvdXApLCBhbmQgYGF1dGhfdG9rZW5gICh1c2VyIGFjY2VzcyB0b2tlbikuXG4gICAgICpcbiAgICAgKiAqSW1wb3J0YW50KjogVGhpcyBtZXRob2QgaXMgc3luY2hyb25vdXMuIFRoZSBzZXNzaW9uIGluZm9ybWF0aW9uIGlzIHJldHVybmVkIGltbWVkaWF0ZWx5IGluIGFuIG9iamVjdDsgbm8gY2FsbGJhY2tzIG9yIHByb21pc2VzIGFyZSBuZWVkZWQuXG4gICAgICpcbiAgICAgKiBCeSBkZWZhdWx0LCBzZXNzaW9uIGluZm9ybWF0aW9uIGlzIHN0b3JlZCBpbiBhIGNvb2tpZSBpbiB0aGUgYnJvd3Nlci4gWW91IGNhbiBjaGFuZ2UgdGhpcyB3aXRoIHRoZSBgc3RvcmVgIGNvbmZpZ3VyYXRpb24gb3B0aW9uLiBcbiAgICAgKlxuICAgICAqICoqRXhhbXBsZSoqXG4gICAgICpcbiAgICAgKiAgICAgIHZhciBzZXNzaW9uT2JqID0gYXV0aE1nci5nZXRDdXJyZW50VXNlclNlc3Npb25JbmZvKCk7XG4gICAgICpcbiAgICAgKiAqKlBhcmFtZXRlcnMqKlxuICAgICAqIEBwYXJhbSB7T2JqZWN0fSBgb3B0aW9uc2AgKE9wdGlvbmFsKSBPdmVycmlkZXMgZm9yIGNvbmZpZ3VyYXRpb24gb3B0aW9ucy5cbiAgICAgKi9cbiAgICBnZXRDdXJyZW50VXNlclNlc3Npb25JbmZvOiBmdW5jdGlvbiAob3B0aW9ucykge1xuICAgICAgICByZXR1cm4gZ2V0U2Vzc2lvbihvcHRpb25zKTtcbiAgICB9XG59KTtcblxubW9kdWxlLmV4cG9ydHMgPSBBdXRoTWFuYWdlcjtcbiIsIid1c2Ugc3RyaWN0JztcblxudmFyIENoYW5uZWwgPSByZXF1aXJlKCcuLi9zZXJ2aWNlL2NoYW5uZWwtc2VydmljZScpO1xuXG4vKipcbiAqICMjIENoYW5uZWwgTWFuYWdlclxuICpcbiAqIFRoZXJlIGFyZSB0d28gbWFpbiB1c2UgY2FzZXMgZm9yIHRoZSBjaGFubmVsOiBldmVudCBub3RpZmljYXRpb25zIGFuZCBjaGF0IG1lc3NhZ2VzLlxuICpcbiAqIFRoZSBDaGFubmVsIE1hbmFnZXIgaXMgYSB3cmFwcGVyIGFyb3VuZCB0aGUgZGVmYXVsdCBbY29tZXRkIEphdmFTY3JpcHQgbGlicmFyeV0oaHR0cDovL2RvY3MuY29tZXRkLm9yZy8yL3JlZmVyZW5jZS9qYXZhc2NyaXB0Lmh0bWwpLCBgJC5jb21ldGRgLiBJdCBwcm92aWRlcyBhIGZldyBuaWNlIGZlYXR1cmVzIHRoYXQgYCQuY29tZXRkYCBkb2Vzbid0LCBpbmNsdWRpbmc6XG4gKlxuICogKiBBdXRvbWF0aWMgcmUtc3Vic2NyaXB0aW9uIHRvIGNoYW5uZWxzIGlmIHlvdSBsb3NlIHlvdXIgY29ubmVjdGlvblxuICogKiBPbmxpbmUgLyBPZmZsaW5lIG5vdGlmaWNhdGlvbnNcbiAqICogJ0V2ZW50cycgZm9yIGNvbWV0ZCBub3RpZmljYXRpb25zIChpbnN0ZWFkIG9mIGhhdmluZyB0byBsaXN0ZW4gb24gc3BlY2lmaWMgbWV0YSBjaGFubmVscylcbiAqXG4gKiBXaGlsZSB5b3UgY2FuIHdvcmsgZGlyZWN0bHkgd2l0aCB0aGUgQ2hhbm5lbCBNYW5hZ2VyIHRocm91Z2ggTm9kZS5qcyAoZm9yIGV4YW1wbGUsIGByZXF1aXJlKCdtYW5hZ2VyL2NoYW5uZWwtbWFuYWdlcicpYCkgLS0gb3IgZXZlbiB3b3JrIGRpcmVjdGx5IHdpdGggYCQuY29tZXRkYCBhbmQgRXBpY2VudGVyJ3MgdW5kZXJseWluZyBbUHVzaCBDaGFubmVsIEFQSV0oLi4vLi4vLi4vcmVzdF9hcGlzL211bHRpcGxheWVyL2NoYW5uZWwvKSAtLSBtb3N0IG9mdGVuIGl0IHdpbGwgYmUgZWFzaWVzdCB0byB3b3JrIHdpdGggdGhlIFtFcGljZW50ZXIgQ2hhbm5lbCBNYW5hZ2VyXSguLi9lcGljZW50ZXItY2hhbm5lbC1tYW5hZ2VyLykuIFRoZSBFcGljZW50ZXIgQ2hhbm5lbCBNYW5hZ2VyIGlzIGEgd3JhcHBlciB0aGF0IGluc3RhbnRpYXRlcyBhIENoYW5uZWwgTWFuYWdlciB3aXRoIEVwaWNlbnRlci1zcGVjaWZpYyBkZWZhdWx0cy5cbiAqXG4gKiBZb3UnbGwgbmVlZCB0byBpbmNsdWRlIHRoZSBgZXBpY2VudGVyLW11bHRpcGxheWVyLWRlcGVuZGVuY2llcy5qc2AgbGlicmFyeSBpbiBhZGRpdGlvbiB0byB0aGUgYGVwaWNlbnRlci5qc2AgbGlicmFyeSBpbiB5b3VyIHByb2plY3QgdG8gdXNlIHRoZSBDaGFubmVsIE1hbmFnZXIuIChTZWUgW0luY2x1ZGluZyBFcGljZW50ZXIuanNdKC4uLy4uLyNpbmNsdWRlKS4pXG4gKlxuICogVG8gdXNlIHRoZSBDaGFubmVsIE1hbmFnZXIgaW4gY2xpZW50LXNpZGUgSmF2YVNjcmlwdCwgaW5zdGFudGlhdGUgdGhlIFtFcGljZW50ZXIgQ2hhbm5lbCBNYW5hZ2VyXSguLi9lcGljZW50ZXItY2hhbm5lbC1tYW5hZ2VyLyksIGdldCB0aGUgY2hhbm5lbCwgdGhlbiB1c2UgdGhlIGNoYW5uZWwncyBgc3Vic2NyaWJlKClgIGFuZCBgcHVibGlzaCgpYCBtZXRob2RzIHRvIHN1YnNjcmliZSB0byB0b3BpY3Mgb3IgcHVibGlzaCBkYXRhIHRvIHRvcGljcy5cbiAqXG4gKiAgICAgICAgdmFyIGNtID0gbmV3IEYubWFuYWdlci5DaGFubmVsTWFuYWdlcigpO1xuICogICAgICAgIHZhciBjaGFubmVsID0gY20uZ2V0Q2hhbm5lbCgpO1xuICogICAgICAgIGNoYW5uZWwuc3Vic2NyaWJlKHRvcGljKTtcbiAqXG4gKiBUaGUgcGFyYW1ldGVycyBmb3IgaW5zdGFudGlhdGluZyBhIENoYW5uZWwgTWFuYWdlciBpbmNsdWRlOlxuICpcbiAqICogYG9wdGlvbnNgIFRoZSBvcHRpb25zIG9iamVjdCB0byBjb25maWd1cmUgdGhlIENoYW5uZWwgTWFuYWdlci4gQmVzaWRlcyB0aGUgY29tbW9uIG9wdGlvbnMgbGlzdGVkIGhlcmUsIHNlZSBodHRwOi8vZG9jcy5jb21ldGQub3JnL3JlZmVyZW5jZS9qYXZhc2NyaXB0Lmh0bWwgZm9yIG90aGVyIHN1cHBvcnRlZCBvcHRpb25zLlxuICogKiBgb3B0aW9ucy51cmxgIFRoZSBDb21ldGQgZW5kcG9pbnQgVVJMLlxuICogKiBgb3B0aW9ucy53ZWJzb2NrZXRFbmFibGVkYCBXaGV0aGVyIHdlYnNvY2tldCBzdXBwb3J0IGlzIGFjdGl2ZSAoYm9vbGVhbikuXG4gKiAqIGBvcHRpb25zLmNoYW5uZWxgIE90aGVyIGRlZmF1bHRzIHRvIHBhc3Mgb24gdG8gaW5zdGFuY2VzIG9mIHRoZSB1bmRlcmx5aW5nIENoYW5uZWwgU2VydmljZS4gU2VlIFtDaGFubmVsIFNlcnZpY2VdKC4uL2NoYW5uZWwtc2VydmljZS8pIGZvciBkZXRhaWxzLlxuICpcbiAqL1xudmFyIENoYW5uZWxNYW5hZ2VyID0gZnVuY3Rpb24gKG9wdGlvbnMpIHtcbiAgICBpZiAoISQuY29tZXRkKSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcignQ29tZXRkIGxpYnJhcnkgbm90IGZvdW5kLiBQbGVhc2UgaW5jbHVkZSBlcGljZW50ZXItbXVsdGlwbGF5ZXItZGVwZW5kZW5jaWVzLmpzJyk7XG4gICAgfVxuICAgIGlmICghb3B0aW9ucyB8fCAhb3B0aW9ucy51cmwpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdQbGVhc2UgcHJvdmlkZSBhbiB1cmwgZm9yIHRoZSBjb21ldGQgc2VydmVyJyk7XG4gICAgfVxuXG4gICAgdmFyIGNvbWV0ZCA9IG5ldyAkLkNvbWV0ZCgpO1xuXG4gICAgdmFyIGRlZmF1bHRzID0ge1xuICAgICAgICAvKipcbiAgICAgICAgICogVGhlIENvbWV0ZCBlbmRwb2ludCBVUkwuXG4gICAgICAgICAqL1xuICAgICAgICB1cmw6ICcnLFxuXG4gICAgICAgIC8qKlxuICAgICAgICAgKiBUaGUgbG9nIGxldmVsIGZvciB0aGUgY2hhbm5lbCAobG9ncyB0byBjb25zb2xlKS5cbiAgICAgICAgICovXG4gICAgICAgIGxvZ0xldmVsOiAnaW5mbycsXG5cbiAgICAgICAgLyoqXG4gICAgICAgICAqIFdoZXRoZXIgd2Vic29ja2V0IHN1cHBvcnQgaXMgYWN0aXZlLiBEZWZhdWx0cyB0byBgZmFsc2VgOyBFcGljZW50ZXIgZG9lc24ndCBjdXJyZW50bHkgY29tbXVuaWNhdGlvbiB0aHJvdWdoIHdlYnNvY2tldHMuXG4gICAgICAgICAqL1xuICAgICAgICB3ZWJzb2NrZXRFbmFibGVkOiBmYWxzZSxcblxuICAgICAgICAvKipcbiAgICAgICAgICogT3RoZXIgZGVmYXVsdHMgdG8gcGFzcyBvbiB0byBpbnN0YW5jZXMgb2YgdGhlIHVuZGVybHlpbmcgW0NoYW5uZWwgU2VydmljZV0oLi4vY2hhbm5lbC1zZXJ2aWNlLyksIHdoaWNoIGFyZSBjcmVhdGVkIHRocm91Z2ggYGdldENoYW5uZWwoKWAuXG4gICAgICAgICAqL1xuICAgICAgICBjaGFubmVsOiB7XG5cbiAgICAgICAgfVxuICAgIH07XG4gICAgdmFyIGRlZmF1bHRDb21ldE9wdGlvbnMgPSAkLmV4dGVuZCh0cnVlLCB7fSwgZGVmYXVsdHMsIG9wdGlvbnMpO1xuXG4gICAgY29tZXRkLndlYnNvY2tldEVuYWJsZWQgPSBkZWZhdWx0Q29tZXRPcHRpb25zLndlYnNvY2tldEVuYWJsZWQ7XG5cbiAgICB0aGlzLmlzQ29ubmVjdGVkID0gZmFsc2U7XG4gICAgdGhpcy5jdXJyZW50U3Vic2NyaXB0aW9ucyA9IFtdO1xuICAgIHRoaXMub3B0aW9ucyA9IGRlZmF1bHRDb21ldE9wdGlvbnM7XG5cbiAgICB2YXIgY29ubmVjdGlvbkJyb2tlbiA9IGZ1bmN0aW9uIChtZXNzYWdlKSB7XG4gICAgICAgICQodGhpcykudHJpZ2dlcignZGlzY29ubmVjdCcsIG1lc3NhZ2UpO1xuICAgIH07XG4gICAgdmFyIGNvbm5lY3Rpb25TdWNjZWVkZWQgPSBmdW5jdGlvbiAobWVzc2FnZSkge1xuICAgICAgICAkKHRoaXMpLnRyaWdnZXIoJ2Nvbm5lY3QnLCBtZXNzYWdlKTtcbiAgICB9O1xuICAgIHZhciBtZSA9IHRoaXM7XG5cbiAgICBjb21ldGQuY29uZmlndXJlKGRlZmF1bHRDb21ldE9wdGlvbnMpO1xuXG4gICAgY29tZXRkLmFkZExpc3RlbmVyKCcvbWV0YS9jb25uZWN0JywgZnVuY3Rpb24gKG1lc3NhZ2UpIHtcbiAgICAgICAgdmFyIHdhc0Nvbm5lY3RlZCA9IHRoaXMuaXNDb25uZWN0ZWQ7XG4gICAgICAgIHRoaXMuaXNDb25uZWN0ZWQgPSAobWVzc2FnZS5zdWNjZXNzZnVsID09PSB0cnVlKTtcbiAgICAgICAgaWYgKCF3YXNDb25uZWN0ZWQgJiYgdGhpcy5pc0Nvbm5lY3RlZCkgeyAvL0Nvbm5lY3RpbmcgZm9yIHRoZSBmaXJzdCB0aW1lXG4gICAgICAgICAgICBjb25uZWN0aW9uU3VjY2VlZGVkLmNhbGwodGhpcywgbWVzc2FnZSk7XG4gICAgICAgIH0gZWxzZSBpZiAod2FzQ29ubmVjdGVkICYmICF0aGlzLmlzQ29ubmVjdGVkKSB7IC8vT25seSB0aHJvdyBkaXNjb25uZWN0ZWQgbWVzc2FnZSBmcm8gdGhlIGZpcnN0IGRpc2Nvbm5lY3QsIG5vdCBvbmNlIHBlciB0cnlcbiAgICAgICAgICAgIGNvbm5lY3Rpb25Ccm9rZW4uY2FsbCh0aGlzLCBtZXNzYWdlKTtcbiAgICAgICAgfVxuICAgIH0uYmluZCh0aGlzKSk7XG5cbiAgICBjb21ldGQuYWRkTGlzdGVuZXIoJy9tZXRhL2Rpc2Nvbm5lY3QnLCBjb25uZWN0aW9uQnJva2VuKTtcblxuICAgIGNvbWV0ZC5hZGRMaXN0ZW5lcignL21ldGEvaGFuZHNoYWtlJywgZnVuY3Rpb24gKG1lc3NhZ2UpIHtcbiAgICAgICAgaWYgKG1lc3NhZ2Uuc3VjY2Vzc2Z1bCkge1xuICAgICAgICAgICAgLy9odHRwOi8vZG9jcy5jb21ldGQub3JnL3JlZmVyZW5jZS9qYXZhc2NyaXB0X3N1YnNjcmliZS5odG1sI2phdmFzY3JpcHRfc3Vic2NyaWJlX21ldGFfY2hhbm5lbHNcbiAgICAgICAgICAgIC8vIF4gXCJkeW5hbWljIHN1YnNjcmlwdGlvbnMgYXJlIGNsZWFyZWQgKGxpa2UgYW55IG90aGVyIHN1YnNjcmlwdGlvbikgYW5kIHRoZSBhcHBsaWNhdGlvbiBuZWVkcyB0byBmaWd1cmUgb3V0IHdoaWNoIGR5bmFtaWMgc3Vic2NyaXB0aW9uIG11c3QgYmUgcGVyZm9ybWVkIGFnYWluXCJcbiAgICAgICAgICAgIGNvbWV0ZC5iYXRjaChmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICAgICAgJChtZS5jdXJyZW50U3Vic2NyaXB0aW9ucykuZWFjaChmdW5jdGlvbiAoaW5kZXgsIHN1YnMpIHtcbiAgICAgICAgICAgICAgICAgICAgY29tZXRkLnJlc3Vic2NyaWJlKHN1YnMpO1xuICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgIH1cbiAgICB9KTtcblxuICAgIC8vT3RoZXIgaW50ZXJlc3RpbmcgZXZlbnRzIGZvciByZWZlcmVuY2VcbiAgICBjb21ldGQuYWRkTGlzdGVuZXIoJy9tZXRhL3N1YnNjcmliZScsIGZ1bmN0aW9uIChtZXNzYWdlKSB7XG4gICAgICAgICQobWUpLnRyaWdnZXIoJ3N1YnNjcmliZScsIG1lc3NhZ2UpO1xuICAgIH0pO1xuICAgIGNvbWV0ZC5hZGRMaXN0ZW5lcignL21ldGEvdW5zdWJzY3JpYmUnLCBmdW5jdGlvbiAobWVzc2FnZSkge1xuICAgICAgICAkKG1lKS50cmlnZ2VyKCd1bnN1YnNjcmliZScsIG1lc3NhZ2UpO1xuICAgIH0pO1xuICAgIGNvbWV0ZC5hZGRMaXN0ZW5lcignL21ldGEvcHVibGlzaCcsIGZ1bmN0aW9uIChtZXNzYWdlKSB7XG4gICAgICAgICQobWUpLnRyaWdnZXIoJ3B1Ymxpc2gnLCBtZXNzYWdlKTtcbiAgICB9KTtcbiAgICBjb21ldGQuYWRkTGlzdGVuZXIoJy9tZXRhL3Vuc3VjY2Vzc2Z1bCcsIGZ1bmN0aW9uIChtZXNzYWdlKSB7XG4gICAgICAgICQobWUpLnRyaWdnZXIoJ2Vycm9yJywgbWVzc2FnZSk7XG4gICAgfSk7XG5cbiAgICBjb21ldGQuaGFuZHNoYWtlKCk7XG5cbiAgICB0aGlzLmNvbWV0ZCA9IGNvbWV0ZDtcbn07XG5cblxuQ2hhbm5lbE1hbmFnZXIucHJvdG90eXBlID0gJC5leHRlbmQoQ2hhbm5lbE1hbmFnZXIucHJvdG90eXBlLCB7XG5cbiAgICAvKipcbiAgICAgKiBDcmVhdGVzIGFuZCByZXR1cm5zIGEgY2hhbm5lbCwgdGhhdCBpcywgYW4gaW5zdGFuY2Ugb2YgYSBbQ2hhbm5lbCBTZXJ2aWNlXSguLi9jaGFubmVsLXNlcnZpY2UvKS5cbiAgICAgKlxuICAgICAqICoqRXhhbXBsZSoqXG4gICAgICpcbiAgICAgKiAgICAgIHZhciBjbSA9IG5ldyBGLm1hbmFnZXIuQ2hhbm5lbE1hbmFnZXIoKTtcbiAgICAgKiAgICAgIHZhciBjaGFubmVsID0gY20uZ2V0Q2hhbm5lbCgpO1xuICAgICAqICAgICAgY2hhbm5lbC5zdWJzY3JpYmUodG9waWMpO1xuICAgICAqXG4gICAgICogKipQYXJhbWV0ZXJzKipcbiAgICAgKiBAcGFyYW0ge05vbmV9IE5vbmVcbiAgICAgKi9cbiAgICBnZXRDaGFubmVsOiBmdW5jdGlvbiAob3B0aW9ucykge1xuICAgICAgICAvL0lmIHlvdSBqdXN0IHdhbnQgdG8gcGFzcyBpbiBhIHN0cmluZ1xuICAgICAgICBpZiAob3B0aW9ucyAmJiAhJC5pc1BsYWluT2JqZWN0KG9wdGlvbnMpKSB7XG4gICAgICAgICAgICBvcHRpb25zID0ge1xuICAgICAgICAgICAgICAgIGJhc2U6IG9wdGlvbnNcbiAgICAgICAgICAgIH07XG4gICAgICAgIH1cbiAgICAgICAgdmFyIGRlZmF1bHRzID0ge1xuICAgICAgICAgICAgdHJhbnNwb3J0OiB0aGlzLmNvbWV0ZFxuICAgICAgICB9O1xuICAgICAgICB2YXIgY2hhbm5lbCA9IG5ldyBDaGFubmVsKCQuZXh0ZW5kKHRydWUsIHt9LCB0aGlzLm9wdGlvbnMuY2hhbm5lbCwgZGVmYXVsdHMsIG9wdGlvbnMpKTtcblxuXG4gICAgICAgIC8vV3JhcCBzdWJzIGFuZCB1bnN1YnMgc28gd2UgY2FuIHVzZSBpdCB0byByZS1hdHRhY2ggaGFuZGxlcnMgYWZ0ZXIgYmVpbmcgZGlzY29ubmVjdGVkXG4gICAgICAgIHZhciBzdWJzID0gY2hhbm5lbC5zdWJzY3JpYmU7XG4gICAgICAgIGNoYW5uZWwuc3Vic2NyaWJlID0gZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgdmFyIHN1YmlkID0gc3Vicy5hcHBseShjaGFubmVsLCBhcmd1bWVudHMpO1xuICAgICAgICAgICAgdGhpcy5jdXJyZW50U3Vic2NyaXB0aW9ucyAgPSB0aGlzLmN1cnJlbnRTdWJzY3JpcHRpb25zLmNvbmNhdChzdWJpZCk7XG4gICAgICAgICAgICByZXR1cm4gc3ViaWQ7XG4gICAgICAgIH0uYmluZCh0aGlzKTtcblxuXG4gICAgICAgIHZhciB1bnN1YnMgPSBjaGFubmVsLnVuc3Vic2NyaWJlO1xuICAgICAgICBjaGFubmVsLnVuc3Vic2NyaWJlID0gZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgdmFyIHJlbW92ZWQgPSB1bnN1YnMuYXBwbHkoY2hhbm5lbCwgYXJndW1lbnRzKTtcbiAgICAgICAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgdGhpcy5jdXJyZW50U3Vic2NyaXB0aW9ucy5sZW5ndGg7IGkrKykge1xuICAgICAgICAgICAgICAgIGlmICh0aGlzLmN1cnJlbnRTdWJzY3JpcHRpb25zW2ldLmlkID09PSByZW1vdmVkLmlkKSB7XG4gICAgICAgICAgICAgICAgICAgIHRoaXMuY3VycmVudFN1YnNjcmlwdGlvbnMuc3BsaWNlKGksIDEpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJldHVybiByZW1vdmVkO1xuICAgICAgICB9LmJpbmQodGhpcyk7XG5cbiAgICAgICAgcmV0dXJuIGNoYW5uZWw7XG4gICAgfSxcblxuICAgIC8qKlxuICAgICAqIFN0YXJ0IGxpc3RlbmluZyBmb3IgZXZlbnRzIG9uIHRoaXMgaW5zdGFuY2UuIFNpZ25hdHVyZSBpcyBzYW1lIGFzIGZvciBqUXVlcnkgRXZlbnRzOiBodHRwOi8vYXBpLmpxdWVyeS5jb20vb24vLlxuICAgICAqXG4gICAgICogU3VwcG9ydGVkIGV2ZW50cyBhcmU6IGBjb25uZWN0YCwgYGRpc2Nvbm5lY3RgLCBgc3Vic2NyaWJlYCwgYHVuc3Vic2NyaWJlYCwgYHB1Ymxpc2hgLCBgZXJyb3JgLlxuICAgICAqXG4gICAgICogKipQYXJhbWV0ZXJzKipcbiAgICAgKlxuICAgICAqIEBwYXJhbSB7c3RyaW5nfSBgZXZlbnRgIFRoZSBldmVudCB0eXBlLiBTZWUgbW9yZSBkZXRhaWwgYXQgalF1ZXJ5IEV2ZW50czogaHR0cDovL2FwaS5qcXVlcnkuY29tL29uLy5cbiAgICAgKi9cbiAgICBvbjogZnVuY3Rpb24gKCkge1xuICAgICAgICAkKHRoaXMpLm9uLmFwcGx5KCQodGhpcyksIGFyZ3VtZW50cyk7XG4gICAgfSxcblxuICAgIC8qKlxuICAgICAqIFN0b3AgbGlzdGVuaW5nIGZvciBldmVudHMgb24gdGhpcyBpbnN0YW5jZS4gU2lnbmF0dXJlIGlzIHNhbWUgYXMgZm9yIGpRdWVyeSBFdmVudHM6IGh0dHA6Ly9hcGkuanF1ZXJ5LmNvbS9vZmYvLlxuICAgICAqXG4gICAgICogKipQYXJhbWV0ZXJzKipcbiAgICAgKlxuICAgICAqIEBwYXJhbSB7c3RyaW5nfSBgZXZlbnRgIFRoZSBldmVudCB0eXBlLiBTZWUgbW9yZSBkZXRhaWwgYXQgalF1ZXJ5IEV2ZW50czogaHR0cDovL2FwaS5qcXVlcnkuY29tL29mZi8uXG4gICAgICovXG4gICAgb2ZmOiBmdW5jdGlvbiAoKSB7XG4gICAgICAgICQodGhpcykub2ZmLmFwcGx5KCQodGhpcyksIGFyZ3VtZW50cyk7XG4gICAgfSxcblxuICAgIC8qKlxuICAgICAqIFRyaWdnZXIgZXZlbnRzIGFuZCBleGVjdXRlIGhhbmRsZXJzLiBTaWduYXR1cmUgaXMgc2FtZSBhcyBmb3IgalF1ZXJ5IEV2ZW50czogaHR0cDovL2FwaS5qcXVlcnkuY29tL3RyaWdnZXIvLlxuICAgICAqXG4gICAgICogKipQYXJhbWV0ZXJzKipcbiAgICAgKlxuICAgICAqIEBwYXJhbSB7c3RyaW5nfSBgZXZlbnRgIFRoZSBldmVudCB0eXBlLiBTZWUgbW9yZSBkZXRhaWwgYXQgalF1ZXJ5IEV2ZW50czogaHR0cDovL2FwaS5qcXVlcnkuY29tL3RyaWdnZXIvLlxuICAgICAqL1xuICAgIHRyaWdnZXI6IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgJCh0aGlzKS50cmlnZ2VyLmFwcGx5KCQodGhpcyksIGFyZ3VtZW50cyk7XG4gICAgfVxufSk7XG5cbm1vZHVsZS5leHBvcnRzID0gQ2hhbm5lbE1hbmFnZXI7XG4iLCIndXNlIHN0cmljdCc7XG5cbi8qKlxuICogIyMgRXBpY2VudGVyIENoYW5uZWwgTWFuYWdlclxuICpcbiAqIFRoZSBFcGljZW50ZXIgcGxhdGZvcm0gcHJvdmlkZXMgYSBwdXNoIGNoYW5uZWwsIHdoaWNoIGFsbG93cyB5b3UgdG8gcHVibGlzaCBhbmQgc3Vic2NyaWJlIHRvIG1lc3NhZ2VzIHdpdGhpbiBhIFtwcm9qZWN0XSguLi8uLi8uLi9nbG9zc2FyeS8jcHJvamVjdHMpLCBbZ3JvdXBdKC4uLy4uLy4uL2dsb3NzYXJ5LyNncm91cHMpLCBvciBbbXVsdGlwbGF5ZXIgd29ybGRdKC4uLy4uLy4uL2dsb3NzYXJ5LyN3b3JsZCkuIFRoZXJlIGFyZSB0d28gbWFpbiB1c2UgY2FzZXMgZm9yIHRoZSBjaGFubmVsOiBldmVudCBub3RpZmljYXRpb25zIGFuZCBjaGF0IG1lc3NhZ2VzLlxuICpcbiAqIFRoZSBFcGljZW50ZXIgQ2hhbm5lbCBNYW5hZ2VyIGlzIGEgd3JhcHBlciBhcm91bmQgdGhlIChtb3JlIGdlbmVyaWMpIFtDaGFubmVsIE1hbmFnZXJdKC4uL2NoYW5uZWwtbWFuYWdlci8pLCB0byBpbnN0YW50aWF0ZSBpdCB3aXRoIEVwaWNlbnRlci1zcGVjaWZpYyBkZWZhdWx0cy4gSWYgeW91IGFyZSBpbnRlcmVzdGVkIGluIGluY2x1ZGluZyBhIG5vdGlmaWNhdGlvbiBvciBjaGF0IGZlYXR1cmUgaW4geW91ciBwcm9qZWN0LCB1c2luZyBhbiBFcGljZW50ZXIgQ2hhbm5lbCBNYW5hZ2VyIGlzIHByb2JhYmx5IHRoZSBlYXNpZXN0IHdheSB0byBnZXQgc3RhcnRlZC5cbiAqXG4gKiBZb3UnbGwgbmVlZCB0byBpbmNsdWRlIHRoZSBgZXBpY2VudGVyLW11bHRpcGxheWVyLWRlcGVuZGVuY2llcy5qc2AgbGlicmFyeSBpbiBhZGRpdGlvbiB0byB0aGUgYGVwaWNlbnRlci5qc2AgbGlicmFyeSBpbiB5b3VyIHByb2plY3QgdG8gdXNlIHRoZSBFcGljZW50ZXIgQ2hhbm5lbCBNYW5hZ2VyLiAoU2VlIFtJbmNsdWRpbmcgRXBpY2VudGVyLmpzXSguLi8uLi8jaW5jbHVkZSkuKVxuICpcbiAqIFRvIHVzZSB0aGUgRXBpY2VudGVyIENoYW5uZWwgTWFuYWdlcjogaW5zdGFudGlhdGUgaXQsIGdldCB0aGUgY2hhbm5lbCBvZiB0aGUgc2NvcGUgeW91IHdhbnQgKFt1c2VyXSguLi8uLi8uLi9nbG9zc2FyeS8jdXNlcnMpLCBbd29ybGRdKC4uLy4uLy4uL2dsb3NzYXJ5LyN3b3JsZCksIG9yIFtncm91cF0oLi4vLi4vLi4vZ2xvc3NhcnkvI2dyb3VwcykpLCB0aGVuIHVzZSB0aGUgY2hhbm5lbCdzIGBzdWJzY3JpYmUoKWAgYW5kIGBwdWJsaXNoKClgIG1ldGhvZHMgdG8gc3Vic2NyaWJlIHRvIHRvcGljcyBvciBwdWJsaXNoIGRhdGEgdG8gdG9waWNzLlxuICpcbiAqICAgICB2YXIgY20gPSBuZXcgRi5tYW5hZ2VyLkNoYW5uZWxNYW5hZ2VyKCk7XG4gKiAgICAgdmFyIGdjID0gY20uZ2V0R3JvdXBDaGFubmVsKCk7XG4gKiAgICAgZ2Muc3Vic2NyaWJlKCdicm9hZGNhc3RzJywgY2FsbGJhY2spO1xuICpcbiAqIEZvciBhZGRpdGlvbmFsIGJhY2tncm91bmQgb24gRXBpY2VudGVyJ3MgcHVzaCBjaGFubmVsLCBzZWUgdGhlIGludHJvZHVjdG9yeSBub3RlcyBvbiB0aGUgW1B1c2ggQ2hhbm5lbCBBUEldKC4uLy4uLy4uL3Jlc3RfYXBpcy9tdWx0aXBsYXllci9jaGFubmVsLykgcGFnZS5cbiAqXG4gKiBUaGUgcGFyYW1ldGVycyBmb3IgaW5zdGFudGlhdGluZyBhbiBFcGljZW50ZXIgQ2hhbm5lbCBNYW5hZ2VyIGluY2x1ZGU6XG4gKlxuICogKiBgc2VydmVyYCBPYmplY3Qgd2l0aCBkZXRhaWxzIGFib3V0IHRoZSBFcGljZW50ZXIgcHJvamVjdCBmb3IgdGhpcyBFcGljZW50ZXIgQ2hhbm5lbCBNYW5hZ2VyIGluc3RhbmNlLlxuICogKiBgc2VydmVyLmFjY291bnRgIFRoZSBFcGljZW50ZXIgYWNjb3VudCBpZCAoKipUZWFtIElEKiogZm9yIHRlYW0gcHJvamVjdHMsICoqVXNlciBJRCoqIGZvciBwZXJzb25hbCBwcm9qZWN0cykuXG4gKiAqIGBzZXJ2ZXIucHJvamVjdGAgRXBpY2VudGVyIHByb2plY3QgaWQuXG4gKi9cblxudmFyIENoYW5uZWxNYW5hZ2VyID0gcmVxdWlyZSgnLi9jaGFubmVsLW1hbmFnZXInKTtcbnZhciBjbGFzc0Zyb20gPSByZXF1aXJlKCcuLi91dGlsL2luaGVyaXQnKTtcbnZhciB1cmxTZXJ2aWNlID0gcmVxdWlyZSgnLi4vc2VydmljZS91cmwtY29uZmlnLXNlcnZpY2UnKTtcblxudmFyIEF1dGhNYW5hZ2VyID0gcmVxdWlyZSgnLi9hdXRoLW1hbmFnZXInKTtcblxudmFyIHNlc3Npb24gPSBuZXcgQXV0aE1hbmFnZXIoKTtcbnZhciBnZXRGcm9tU2Vzc2lvbk9yRXJyb3IgPSBmdW5jdGlvbiAodmFsdWUsIHNlc3Npb25LZXlOYW1lKSB7XG4gICAgaWYgKCF2YWx1ZSkge1xuICAgICAgICB2YXIgdXNlckluZm8gPSBzZXNzaW9uLmdldEN1cnJlbnRVc2VyU2Vzc2lvbkluZm8oKTtcbiAgICAgICAgaWYgKHVzZXJJbmZvW3Nlc3Npb25LZXlOYW1lXSkge1xuICAgICAgICAgICAgdmFsdWUgPSB1c2VySW5mb1tzZXNzaW9uS2V5TmFtZV07XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3Ioc2Vzc2lvbktleU5hbWUgKyAnIG5vdCBmb3VuZC4gUGxlYXNlIGxvZy1pbiBhZ2Fpbiwgb3Igc3BlY2lmeSAnICsgc2Vzc2lvbktleU5hbWUgKyAnIGV4cGxpY2l0bHknKTtcbiAgICAgICAgfVxuICAgIH1cbiAgICByZXR1cm4gdmFsdWU7XG59O1xudmFyIF9fc3VwZXIgPSBDaGFubmVsTWFuYWdlci5wcm90b3R5cGU7XG52YXIgRXBpY2VudGVyQ2hhbm5lbE1hbmFnZXIgPSBjbGFzc0Zyb20oQ2hhbm5lbE1hbmFnZXIsIHtcbiAgICBjb25zdHJ1Y3RvcjogZnVuY3Rpb24gKG9wdGlvbnMpIHtcbiAgICAgICAgdmFyIHVzZXJJbmZvID0gc2Vzc2lvbi5nZXRDdXJyZW50VXNlclNlc3Npb25JbmZvKCk7XG5cbiAgICAgICAgdmFyIGRlZmF1bHRzID0ge1xuICAgICAgICAgICAgLy9TZWUgZG9jcyBmb3IgdXJsIGNvbmZpZyBzZXJ2aWNlXG4gICAgICAgICAgICBzZXJ2ZXI6IHtcbiAgICAgICAgICAgICAgICBhY2NvdW50OiB1c2VySW5mby5hY2NvdW50LFxuICAgICAgICAgICAgICAgIHByb2plY3Q6IHVzZXJJbmZvLnByb2plY3RcbiAgICAgICAgICAgIH1cbiAgICAgICAgfTtcbiAgICAgICAgdmFyIGRlZmF1bHRDb21ldE9wdGlvbnMgPSAkLmV4dGVuZCh0cnVlLCB7fSwgZGVmYXVsdHMsIHVzZXJJbmZvLCBvcHRpb25zKTtcblxuICAgICAgICB2YXIgdXJsT3B0cyA9IHVybFNlcnZpY2UoZGVmYXVsdENvbWV0T3B0aW9ucy5zZXJ2ZXIpO1xuICAgICAgICBpZiAoIWRlZmF1bHRDb21ldE9wdGlvbnMudXJsKSB7XG4gICAgICAgICAgICAvL0RlZmF1bHQgZXBpY2VudGVyIGNvbWV0ZCBlbmRwb2ludFxuICAgICAgICAgICAgZGVmYXVsdENvbWV0T3B0aW9ucy51cmwgPSB1cmxPcHRzLnByb3RvY29sICsgJzovLycgKyB1cmxPcHRzLmhvc3QgKyAnL2NoYW5uZWwvc3Vic2NyaWJlJztcbiAgICAgICAgfVxuXG4gICAgICAgIHRoaXMub3B0aW9ucyA9IGRlZmF1bHRDb21ldE9wdGlvbnM7XG4gICAgICAgIHJldHVybiBfX3N1cGVyLmNvbnN0cnVjdG9yLmNhbGwodGhpcywgZGVmYXVsdENvbWV0T3B0aW9ucyk7XG4gICAgfSxcblxuICAgIC8qKlxuICAgICAqIENyZWF0ZSBhbmQgcmV0dXJuIGEgcHVibGlzaC9zdWJzY3JpYmUgY2hhbm5lbCAoZnJvbSB0aGUgdW5kZXJseWluZyBbQ2hhbm5lbCBNYW5hZ2VyXSguLi9jaGFubmVsLW1hbmFnZXIvKSkgZm9yIHRoZSBnaXZlbiBbZ3JvdXBdKC4uLy4uLy4uL2dsb3NzYXJ5LyNncm91cHMpLiBUaGUgZ3JvdXAgbXVzdCBiZSBvbmUgb2YgdGhlIGdyb3VwcyBpbiB0aGlzIGFjY291bnQgKHRlYW0pIGFuZCBwcm9qZWN0LlxuICAgICAqXG4gICAgICogVGhlcmUgYXJlIG5vIG5vdGlmaWNhdGlvbnMgZnJvbSBFcGljZW50ZXIgb24gdGhpcyBjaGFubmVsOyBhbGwgbWVzc2FnZXMgYXJlIHVzZXItb3JnaW5hdGVkLlxuICAgICAqXG4gICAgICogKipFeGFtcGxlKipcbiAgICAgKlxuICAgICAqICAgICB2YXIgY20gPSBuZXcgRi5tYW5hZ2VyLkNoYW5uZWxNYW5hZ2VyKCk7XG4gICAgICogICAgIHZhciBnYyA9IGNtLmdldEdyb3VwQ2hhbm5lbCgpO1xuICAgICAqICAgICBnYy5zdWJzY3JpYmUoJ2Jyb2FkY2FzdHMnLCBjYWxsYmFjayk7XG4gICAgICpcbiAgICAgKiAqKlJldHVybiBWYWx1ZSoqXG4gICAgICpcbiAgICAgKiAqICpDaGFubmVsKiBSZXR1cm5zIHRoZSBjaGFubmVsIChhbiBpbnN0YW5jZSBvZiB0aGUgW0NoYW5uZWwgU2VydmljZV0oLi4vY2hhbm5lbC1zZXJ2aWNlLykpLlxuICAgICAqXG4gICAgICogKipQYXJhbWV0ZXJzKipcbiAgICAgKlxuICAgICAqIEBwYXJhbSAge1N0cmluZ30gYGdyb3VwTmFtZWAgKE9wdGlvbmFsKSBHcm91cCB0byBicm9hZGNhc3QgdG8uIElmIG5vdCBwcm92aWRlZCwgcGlja3MgdXAgZ3JvdXAgZnJvbSBjdXJyZW50IHNlc3Npb24gaWYgZW5kIHVzZXIgaXMgbG9nZ2VkIGluLlxuICAgICAqL1xuICAgIGdldEdyb3VwQ2hhbm5lbDogZnVuY3Rpb24gKGdyb3VwTmFtZSkge1xuICAgICAgICBncm91cE5hbWUgPSBnZXRGcm9tU2Vzc2lvbk9yRXJyb3IoZ3JvdXBOYW1lLCAnZ3JvdXBOYW1lJyk7XG4gICAgICAgIHZhciBiYXNlVG9waWMgPSBbJy9ncm91cCcsIHRoaXMub3B0aW9ucy5zZXJ2ZXIuYWNjb3VudCwgdGhpcy5vcHRpb25zLnNlcnZlci5wcm9qZWN0LCBncm91cE5hbWVdLmpvaW4oJy8nKTtcbiAgICAgICAgcmV0dXJuIF9fc3VwZXIuZ2V0Q2hhbm5lbC5jYWxsKHRoaXMsIHsgYmFzZTogYmFzZVRvcGljIH0pO1xuICAgIH0sXG5cbiAgICAvKipcbiAgICAgKiBDcmVhdGUgYW5kIHJldHVybiBhIHB1Ymxpc2gvc3Vic2NyaWJlIGNoYW5uZWwgKGZyb20gdGhlIHVuZGVybHlpbmcgW0NoYW5uZWwgTWFuYWdlcl0oLi4vY2hhbm5lbC1tYW5hZ2VyLykpIGZvciB0aGUgZ2l2ZW4gW3dvcmxkXSguLi8uLi8uLi9nbG9zc2FyeS8jd29ybGQpLlxuICAgICAqXG4gICAgICogVGhpcyBpcyB0eXBpY2FsbHkgdXNlZCB0b2dldGhlciB3aXRoIHRoZSBbV29ybGQgTWFuYWdlcl0oLi4vd29ybGQtbWFuYWdlcikuXG4gICAgICpcbiAgICAgKiAqKkV4YW1wbGUqKlxuICAgICAqXG4gICAgICogICAgIHZhciBjbSA9IG5ldyBGLm1hbmFnZXIuQ2hhbm5lbE1hbmFnZXIoKTtcbiAgICAgKiAgICAgdmFyIHdvcmxkTWFuYWdlciA9IG5ldyBGLm1hbmFnZXIuV29ybGRNYW5hZ2VyKHtcbiAgICAgKiAgICAgICAgIGFjY291bnQ6ICdhY21lLXNpbXVsYXRpb25zJyxcbiAgICAgKiAgICAgICAgIHByb2plY3Q6ICdzdXBwbHktY2hhaW4tZ2FtZScsXG4gICAgICogICAgICAgICBtb2RlbDogJ21vZGVsLmVxbidcbiAgICAgKiAgICAgfSk7XG4gICAgICogICAgIHdvcmxkTWFuYWdlci5nZXRDdXJyZW50V29ybGQoKS50aGVuKGZ1bmN0aW9uICh3b3JsZE9iamVjdCwgd29ybGRTZXJ2aWNlKSB7XG4gICAgICogICAgICAgICB2YXIgd29ybGRDaGFubmVsID0gY20uZ2V0V29ybGRDaGFubmVsKHdvcmxkT2JqZWN0KTtcbiAgICAgKiAgICAgICAgIHdvcmxkQ2hhbm5lbC5zdWJzY3JpYmUoJycsIGZ1bmN0aW9uIChkYXRhKSB7XG4gICAgICogICAgICAgICAgICAgY29uc29sZS5sb2coZGF0YSk7XG4gICAgICogICAgICAgICB9KTtcbiAgICAgKiAgICAgIH0pO1xuICAgICAqXG4gICAgICogKipSZXR1cm4gVmFsdWUqKlxuICAgICAqXG4gICAgICogKiAqQ2hhbm5lbCogUmV0dXJucyB0aGUgY2hhbm5lbCAoYW4gaW5zdGFuY2Ugb2YgdGhlIFtDaGFubmVsIFNlcnZpY2VdKC4uL2NoYW5uZWwtc2VydmljZS8pKS5cbiAgICAgKlxuICAgICAqICoqUGFyYW1ldGVycyoqXG4gICAgICpcbiAgICAgKiBAcGFyYW0gIHtTdHJpbmd8T2JqZWN0fSBgd29ybGRgIFRoZSB3b3JsZCBvYmplY3Qgb3IgaWQuXG4gICAgICogQHBhcmFtICB7U3RyaW5nfSBgZ3JvdXBOYW1lYCAoT3B0aW9uYWwpIEdyb3VwIHRoZSB3b3JsZCBleGlzdHMgaW4uIElmIG5vdCBwcm92aWRlZCwgcGlja3MgdXAgZ3JvdXAgZnJvbSBjdXJyZW50IHNlc3Npb24gaWYgZW5kIHVzZXIgaXMgbG9nZ2VkIGluLlxuICAgICAqL1xuICAgIGdldFdvcmxkQ2hhbm5lbDogZnVuY3Rpb24gKHdvcmxkLCBncm91cE5hbWUpIHtcbiAgICAgICAgdmFyIHdvcmxkaWQgPSAoJC5pc1BsYWluT2JqZWN0KHdvcmxkKSAmJiB3b3JsZC5pZCkgPyB3b3JsZC5pZCA6IHdvcmxkO1xuICAgICAgICBpZiAoIXdvcmxkaWQpIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcignUGxlYXNlIHNwZWNpZnkgYSB3b3JsZCBpZCcpO1xuICAgICAgICB9XG4gICAgICAgIGdyb3VwTmFtZSA9IGdldEZyb21TZXNzaW9uT3JFcnJvcihncm91cE5hbWUsICdncm91cE5hbWUnKTtcbiAgICAgICAgdmFyIGJhc2VUb3BpYyA9IFsnL3dvcmxkJywgdGhpcy5vcHRpb25zLnNlcnZlci5hY2NvdW50LCB0aGlzLm9wdGlvbnMuc2VydmVyLnByb2plY3QsIGdyb3VwTmFtZSwgd29ybGRpZF0uam9pbignLycpO1xuICAgICAgICByZXR1cm4gX19zdXBlci5nZXRDaGFubmVsLmNhbGwodGhpcywgeyBiYXNlOiBiYXNlVG9waWMgfSk7XG4gICAgfSxcblxuICAgIC8qKlxuICAgICAqIENyZWF0ZSBhbmQgcmV0dXJuIGEgcHVibGlzaC9zdWJzY3JpYmUgY2hhbm5lbCAoZnJvbSB0aGUgdW5kZXJseWluZyBbQ2hhbm5lbCBNYW5hZ2VyXSguLi9jaGFubmVsLW1hbmFnZXIvKSkgZm9yIHRoZSBjdXJyZW50IFtlbmQgdXNlcl0oLi4vLi4vLi4vZ2xvc3NhcnkvI3VzZXIpIGluIHRoYXQgdXNlcidzIGN1cnJlbnQgW3dvcmxkXSguLi8uLi8uLi9nbG9zc2FyeS8jd29ybGQpLlxuICAgICAqXG4gICAgICogVGhpcyBpcyB0eXBpY2FsbHkgdXNlZCB0b2dldGhlciB3aXRoIHRoZSBbV29ybGQgTWFuYWdlcl0oLi4vd29ybGQtbWFuYWdlcikuIE5vdGUgdGhhdCB0aGlzIGNoYW5uZWwgb25seSBnZXRzIG5vdGlmaWNhdGlvbnMgZm9yIHdvcmxkcyBjdXJyZW50bHkgaW4gbWVtb3J5LiAoU2VlIG1vcmUgYmFja2dyb3VuZCBvbiBbcGVyc2lzdGVuY2VdKC4uLy4uLy4uL3J1bl9wZXJzaXN0ZW5jZSkuKVxuICAgICAqXG4gICAgICogKipFeGFtcGxlKipcbiAgICAgKlxuICAgICAqICAgICB2YXIgY20gPSBuZXcgRi5tYW5hZ2VyLkNoYW5uZWxNYW5hZ2VyKCk7XG4gICAgICogICAgIHZhciB3b3JsZE1hbmFnZXIgPSBuZXcgRi5tYW5hZ2VyLldvcmxkTWFuYWdlcih7XG4gICAgICogICAgICAgICBhY2NvdW50OiAnYWNtZS1zaW11bGF0aW9ucycsXG4gICAgICogICAgICAgICBwcm9qZWN0OiAnc3VwcGx5LWNoYWluLWdhbWUnLFxuICAgICAqICAgICAgICAgbW9kZWw6ICdtb2RlbC5lcW4nXG4gICAgICogICAgIH0pO1xuICAgICAqICAgICB3b3JsZE1hbmFnZXIuZ2V0Q3VycmVudFdvcmxkKCkudGhlbihmdW5jdGlvbiAod29ybGRPYmplY3QsIHdvcmxkU2VydmljZSkge1xuICAgICAqICAgICAgICAgdmFyIHVzZXJDaGFubmVsID0gY20uZ2V0VXNlckNoYW5uZWwod29ybGRPYmplY3QpO1xuICAgICAqICAgICAgICAgdXNlckNoYW5uZWwuc3Vic2NyaWJlKCcnLCBmdW5jdGlvbiAoZGF0YSkge1xuICAgICAqICAgICAgICAgICAgIGNvbnNvbGUubG9nKGRhdGEpO1xuICAgICAqICAgICAgICAgfSk7XG4gICAgICogICAgICB9KTtcbiAgICAgKlxuICAgICAqXG4gICAgICogKipSZXR1cm4gVmFsdWUqKlxuICAgICAqXG4gICAgICogKiAqQ2hhbm5lbCogUmV0dXJucyB0aGUgY2hhbm5lbCAoYW4gaW5zdGFuY2Ugb2YgdGhlIFtDaGFubmVsIFNlcnZpY2VdKC4uL2NoYW5uZWwtc2VydmljZS8pKS5cbiAgICAgKlxuICAgICAqICoqUGFyYW1ldGVycyoqXG4gICAgICpcbiAgICAgKiBAcGFyYW0gIHtTdHJpbmd8T2JqZWN0fSBgd29ybGRgIFdvcmxkIG9iamVjdCBvciBpZC5cbiAgICAgKiBAcGFyYW0gIHtTdHJpbmd8T2JqZWN0fSBgdXNlcmAgKE9wdGlvbmFsKSBVc2VyIG9iamVjdCBvciBpZC4gSWYgbm90IHByb3ZpZGVkLCBwaWNrcyB1cCBzZXIgaWQgZnJvbSBjdXJyZW50IHNlc3Npb24gaWYgZW5kIHVzZXIgaXMgbG9nZ2VkIGluLlxuICAgICAqIEBwYXJhbSAge1N0cmluZ30gYGdyb3VwTmFtZWAgKE9wdGlvbmFsKSBHcm91cCB0aGUgd29ybGQgZXhpc3RzIGluLiBJZiBub3QgcHJvdmlkZWQsIHBpY2tzIHVwIGdyb3VwIGZyb20gY3VycmVudCBzZXNzaW9uIGlmIGVuZCB1c2VyIGlzIGxvZ2dlZCBpbi5cbiAgICAgKi9cbiAgICBnZXRVc2VyQ2hhbm5lbDogZnVuY3Rpb24gKHdvcmxkLCB1c2VyLCBncm91cE5hbWUpIHtcbiAgICAgICAgdmFyIHVzZXJpZCA9ICgkLmlzUGxhaW5PYmplY3QodXNlcikgJiYgdXNlci5pZCkgPyB1c2VyLmlkIDogdXNlcjtcbiAgICAgICAgdmFyIHdvcmxkaWQgPSAoJC5pc1BsYWluT2JqZWN0KHdvcmxkKSAmJiB3b3JsZC5pZCkgPyB3b3JsZC5pZCA6IHdvcmxkO1xuICAgICAgICBpZiAoIXdvcmxkaWQpIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcignUGxlYXNlIHNwZWNpZnkgYSB3b3JsZCBpZCcpO1xuICAgICAgICB9XG4gICAgICAgIHVzZXJpZCA9IGdldEZyb21TZXNzaW9uT3JFcnJvcih1c2VyaWQsICd1c2VySWQnKTtcbiAgICAgICAgZ3JvdXBOYW1lID0gZ2V0RnJvbVNlc3Npb25PckVycm9yKGdyb3VwTmFtZSwgJ2dyb3VwTmFtZScpO1xuXG4gICAgICAgIHZhciBiYXNlVG9waWMgPSBbJy91c2VycycsIHRoaXMub3B0aW9ucy5zZXJ2ZXIuYWNjb3VudCwgdGhpcy5vcHRpb25zLnNlcnZlci5wcm9qZWN0LCBncm91cE5hbWUsIHdvcmxkaWQsIHVzZXJpZF0uam9pbignLycpO1xuICAgICAgICByZXR1cm4gX19zdXBlci5nZXRDaGFubmVsLmNhbGwodGhpcywgeyBiYXNlOiBiYXNlVG9waWMgfSk7XG4gICAgfVxufSk7XG5cbm1vZHVsZS5leHBvcnRzID0gRXBpY2VudGVyQ2hhbm5lbE1hbmFnZXI7XG4iLCIndXNlIHN0cmljdCc7XG5cbm1vZHVsZS5leHBvcnRzID0ge1xuICAgIEVQSV9DT09LSUVfS0VZOiAnZXBpY2VudGVyLnByb2plY3QudG9rZW4nLFxuICAgIEVQSV9TRVNTSU9OX0tFWTogJ2VwaWNlbnRlci51c2VyLnNlc3Npb24nLFxuICAgIFNUUkFURUdZX1NFU1NJT05fS0VZOiAnZXBpY2VudGVyLXNjZW5hcmlvJ1xufTsiLCIvKipcbiogIyMgUnVuIE1hbmFnZXJcbipcbiogVGhlIFJ1biBNYW5hZ2VyIGdpdmVzIHlvdSBjb250cm9sIG92ZXIgcnVuIGNyZWF0aW9uIGRlcGVuZGluZyBvbiBydW4gc3RhdGVzLiBTcGVjaWZpY2FsbHksIHlvdSBjYW4gc2VsZWN0IHJ1biBjcmVhdGlvbiBzdHJhdGVnaWVzIChydWxlcykgZm9yIHdoaWNoIHJ1bnMgZW5kIHVzZXJzIG9mIHlvdXIgcHJvamVjdCB3b3JrIHdpdGggd2hlbiB0aGV5IGxvZyBpbiB0byB5b3VyIHByb2plY3QuXG4qXG4qIFVuZGVybHlpbmcgRXBpY2VudGVyIEFQSXMgLS0gaW5jbHVkaW5nIHRoZSBbTW9kZWwgUnVuIEFQSV0oLi4vLi4vLi4vcmVzdF9hcGlzL290aGVyX2FwaXMvbW9kZWxfYXBpcy9ydW4vKSwgdGhlIFtSdW4gQVBJXSguLi8uLi8uLi9yZXN0X2FwaXMvYWdncmVnYXRlX3J1bl9hcGkpLCBhbmQgRXBpY2VudGVyLmpzJ3Mgb3duIFtGLnNlcnZpY2UuUnVuLmNyZWF0ZSgpXSguLi9ydW4tYXBpLXNlcnZpY2UvKSAtLSBhbGwgYWxsb3cgeW91IHRvIGNyZWF0ZSBuZXcgcnVucy4gSG93ZXZlciwgZm9yIHNvbWUgcHJvamVjdHMgaXQgbWFrZXMgbW9yZSBzZW5zZSB0byBwaWNrIHVwIHdoZXJlIHRoZSB1c2VyIGxlZnQgb2ZmLCB1c2luZyBhbiBleGlzdGluZyBydW4uIEFuZCBpbiBzb21lIHByb2plY3RzLCB3aGV0aGVyIHRvIGNyZWF0ZSBhIG5ldyBvbmUgb3IgdXNlIGFuIGV4aXN0aW5nIG9uZSBpcyBjb25kaXRpb25hbCwgZm9yIGV4YW1wbGUgYmFzZWQgb24gY2hhcmFjdGVyaXN0aWNzIG9mIHRoZSBleGlzdGluZyBydW4gb3IgeW91ciBvd24ga25vd2xlZGdlIGFib3V0IHRoZSBtb2RlbC4gVGhlIFJ1biBNYW5hZ2VyIHByb3ZpZGVzIHRoaXMgbGV2ZWwgb2YgY29udHJvbC5cbipcbiogIyMjIFVzaW5nIHRoZSBSdW4gTWFuYWdlciB0byBjcmVhdGUgYW5kIGFjY2VzcyBydW5zXG4qXG4qIFRvIHVzZSB0aGUgUnVuIE1hbmFnZXIsIGluc3RhbnRpYXRlIGl0IGJ5IHBhc3NpbmcgaW46XG4qXG4qICAgKiBgcnVuYDogKHJlcXVpcmVkKSBSdW4gb2JqZWN0LiBNdXN0IGNvbnRhaW46XG4qICAgICAgICogYGFjY291bnRgOiBFcGljZW50ZXIgYWNjb3VudCBpZCAoKipUZWFtIElEKiogZm9yIHRlYW0gcHJvamVjdHMsICoqVXNlciBJRCoqIGZvciBwZXJzb25hbCBwcm9qZWN0cykuXG4qICAgICAgICogYHByb2plY3RgOiBFcGljZW50ZXIgcHJvamVjdCBpZC5cbiogICAgICAgKiBgbW9kZWxgOiBUaGUgbmFtZSBvZiB5b3VyIHByaW1hcnkgbW9kZWwgZmlsZS4gKFNlZSBtb3JlIG9uIFtXcml0aW5nIHlvdXIgTW9kZWxdKC4uLy4uLy4uL3dyaXRpbmdfeW91cl9tb2RlbC8pLilcbiogICAgICAgKiBgc2NvcGVgOiAob3B0aW9uYWwpIFNjb3BlIG9iamVjdCBmb3IgdGhlIHJ1biwgZm9yIGV4YW1wbGUgYHNjb3BlLmdyb3VwYCB3aXRoIHZhbHVlIG9mIHRoZSBuYW1lIG9mIHRoZSBncm91cC5cbiogICAgICAgKiBgZmlsZXNgOiAob3B0aW9uYWwpIElmIGFuZCBvbmx5IGlmIHlvdSBhcmUgdXNpbmcgYSBWZW5zaW0gbW9kZWwgYW5kIHlvdSBoYXZlIGFkZGl0aW9uYWwgZGF0YSB0byBwYXNzIGluIHRvIHlvdXIgbW9kZWwsIHlvdSBjYW4gcGFzcyBhIGBmaWxlc2Agb2JqZWN0IHdpdGggdGhlIG5hbWVzIG9mIHRoZSBmaWxlcywgZm9yIGV4YW1wbGU6IGBcImZpbGVzXCI6IHtcImRhdGFcIjogXCJteUV4dHJhRGF0YS54bHNcIn1gLiAoTm90ZSB0aGF0IHlvdSdsbCBhbHNvIG5lZWQgdG8gYWRkIHRoaXMgc2FtZSBmaWxlcyBvYmplY3QgdG8geW91ciBWZW5zaW0gW2NvbmZpZ3VyYXRpb24gZmlsZV0oLi4vLi4vLi4vbW9kZWxfY29kZS92ZW5zaW0vKS4pIFNlZSB0aGUgW3VuZGVybHlpbmcgTW9kZWwgUnVuIEFQSV0oLi4vLi4vLi4vcmVzdF9hcGlzL290aGVyX2FwaXMvbW9kZWxfYXBpcy9ydW4vI3Bvc3QtY3JlYXRpbmctYS1uZXctcnVuLWZvci10aGlzLXByb2plY3QpIGZvciBhZGRpdGlvbmFsIGluZm9ybWF0aW9uLlxuKlxuKiAgICogYHN0cmF0ZWd5YDogKG9wdGlvbmFsKSBSdW4gY3JlYXRpb24gc3RyYXRlZ3kgZm9yIHdoZW4gdG8gY3JlYXRlIGEgbmV3IHJ1biBhbmQgd2hlbiB0byByZXVzZSBhbiBlbmQgdXNlcidzIGV4aXN0aW5nIHJ1bi4gU2VlIFtSdW4gTWFuYWdlciBTdHJhdGVnaWVzXSguLi8uLi9zdHJhdGVneS8pIGZvciBkZXRhaWxzLiBEZWZhdWx0cyB0byBgbmV3LWlmLWluaXRpYWxpemVkYC5cbipcbiogICAqIGBzZXNzaW9uS2V5YDogKG9wdGlvbmFsKSBOYW1lIG9mIGJyb3dzZXIgY29va2llIGluIHdoaWNoIHRvIHN0b3JlIHJ1biBpbmZvcm1hdGlvbiwgaW5jbHVkaW5nIHJ1biBpZC4gTWFueSBjb25kaXRpb25hbCBzdHJhdGVnaWVzLCBpbmNsdWRpbmcgdGhlIHByb3ZpZGVkIHN0cmF0ZWdpZXMsIHJlbHkgb24gdGhpcyBicm93c2VyIGNvb2tpZSB0byBzdG9yZSB0aGUgcnVuIGlkIGFuZCBoZWxwIG1ha2UgdGhlIGRlY2lzaW9uIG9mIHdoZXRoZXIgdG8gY3JlYXRlIGEgbmV3IHJ1biBvciB1c2UgYW4gZXhpc3Rpbmcgb25lLiBUaGUgbmFtZSBvZiB0aGlzIGNvb2tpZSBkZWZhdWx0cyB0byBgZXBpY2VudGVyLXNjZW5hcmlvYCBhbmQgY2FuIGJlIHNldCB3aXRoIHRoZSBgc2Vzc2lvbktleWAgcGFyYW1ldGVyLlxuKlxuKlxuKiBBZnRlciBpbnN0YW50aWF0aW5nIGEgUnVuIE1hbmFnZXIsIG1ha2UgYSBjYWxsIHRvIGBnZXRSdW4oKWAgd2hlbmV2ZXIgeW91IG5lZWQgdG8gYWNjZXNzIGEgcnVuIGZvciB0aGlzIGVuZCB1c2VyLiBUaGUgYFJ1bk1hbmFnZXIucnVuYCBjb250YWlucyB0aGUgaW5zdGFudGlhdGVkIFtSdW4gU2VydmljZV0oLi4vcnVuLWFwaS1zZXJ2aWNlLykuXG4qXG4qICoqRXhhbXBsZSoqXG4qXG4qICAgICAgIHZhciBybSA9IG5ldyBGLm1hbmFnZXIuUnVuTWFuYWdlcih7XG4qICAgICAgICAgICBydW46IHtcbiogICAgICAgICAgICAgICBhY2NvdW50OiAnYWNtZS1zaW11bGF0aW9ucycsXG4qICAgICAgICAgICAgICAgcHJvamVjdDogJ3N1cHBseS1jaGFpbi1nYW1lJyxcbiogICAgICAgICAgICAgICBtb2RlbDogJ3N1cHBseS1jaGFpbi1tb2RlbC5qbCcsXG4qICAgICAgICAgICAgICAgc2VydmVyOiB7IGhvc3Q6ICdhcGkuZm9yaW8uY29tJyB9XG4qICAgICAgICAgICB9LFxuKiAgICAgICAgICAgc3RyYXRlZ3k6ICdhbHdheXMtbmV3JyxcbiogICAgICAgICAgIHNlc3Npb25LZXk6ICdlcGljZW50ZXItc2Vzc2lvbidcbiogICAgICAgfSk7XG4qICAgICAgIHJtLmdldFJ1bigpXG4qICAgICAgICAgICAudGhlbihmdW5jdGlvbihydW4pIHtcbiogICAgICAgICAgICAgICAvLyB0aGUgcmV0dXJuIHZhbHVlIG9mIGdldFJ1bigpIGlzIGFuIGluc3RhbmNlIG9mIFJ1biBTZXJ2aWNlXG4qICAgICAgICAgICAgICAgdmFyIHRoaXNSdW5JZCA9IHJ1bi5pZDtcbiogICAgICAgICAgICAgICAvLyB0aGUgUnVuTWFuYWdlci5ydW4gYWxzbyBjb250YWlucyB0aGUgaW5zdGFudGlhdGVkIFJ1biBTZXJ2aWNlLFxuKiAgICAgICAgICAgICAgIC8vIHNvIGFueSBSdW4gU2VydmljZSBtZXRob2QgaXMgdmFsaWQgaGVyZVxuKiAgICAgICAgICAgICAgIHJtLnJ1bi5kbygncnVuTW9kZWwnKTtcbiogICAgICAgfSlcbipcbiovXG5cbid1c2Ugc3RyaWN0JztcbnZhciBzdHJhdGVnaWVzTWFwID0gcmVxdWlyZSgnLi9ydW4tc3RyYXRlZ2llcy9zdHJhdGVnaWVzLW1hcCcpO1xudmFyIHNwZWNpYWxPcGVyYXRpb25zID0gcmVxdWlyZSgnLi9zcGVjaWFsLW9wZXJhdGlvbnMnKTtcbnZhciBSdW5TZXJ2aWNlID0gcmVxdWlyZSgnLi4vc2VydmljZS9ydW4tYXBpLXNlcnZpY2UnKTtcblxuXG5mdW5jdGlvbiBwYXRjaFJ1blNlcnZpY2Uoc2VydmljZSwgbWFuYWdlcikge1xuICAgIGlmIChzZXJ2aWNlLnBhdGNoZWQpIHtcbiAgICAgICAgcmV0dXJuIHNlcnZpY2U7XG4gICAgfVxuXG4gICAgdmFyIG9yaWcgPSBzZXJ2aWNlLmRvO1xuICAgIHNlcnZpY2UuZG8gPSBmdW5jdGlvbiAob3BlcmF0aW9uLCBwYXJhbXMsIG9wdGlvbnMpIHtcbiAgICAgICAgdmFyIHJlc2VydmVkT3BzID0gT2JqZWN0LmtleXMoc3BlY2lhbE9wZXJhdGlvbnMpO1xuICAgICAgICBpZiAocmVzZXJ2ZWRPcHMuaW5kZXhPZihvcGVyYXRpb24pID09PSAtMSkge1xuICAgICAgICAgICAgcmV0dXJuIG9yaWcuYXBwbHkoc2VydmljZSwgYXJndW1lbnRzKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHJldHVybiBzcGVjaWFsT3BlcmF0aW9uc1tvcGVyYXRpb25dLmNhbGwoc2VydmljZSwgcGFyYW1zLCBvcHRpb25zLCBtYW5hZ2VyKTtcbiAgICAgICAgfVxuICAgIH07XG5cbiAgICBzZXJ2aWNlLnBhdGNoZWQgPSB0cnVlO1xuXG4gICAgcmV0dXJuIHNlcnZpY2U7XG59XG5cblxuXG52YXIgZGVmYXVsdHMgPSB7XG4gICAgLyoqXG4gICAgICogUnVuIGNyZWF0aW9uIHN0cmF0ZWd5IGZvciB3aGVuIHRvIGNyZWF0ZSBhIG5ldyBydW4gYW5kIHdoZW4gdG8gcmV1c2UgYW4gZW5kIHVzZXIncyBleGlzdGluZyBydW4uIFNlZSBbUnVuIE1hbmFnZXIgU3RyYXRlZ2llc10oLi4vLi4vc3RyYXRlZ3kvKSBmb3IgZGV0YWlscy4gRGVmYXVsdHMgdG8gYG5ldy1pZi1pbml0aWFsaXplZGAuXG4gICAgICogQHR5cGUge1N0cmluZ31cbiAgICAgKi9cblxuICAgIHN0cmF0ZWd5OiAnbmV3LWlmLWluaXRpYWxpemVkJ1xufTtcblxuZnVuY3Rpb24gUnVuTWFuYWdlcihvcHRpb25zKSB7XG4gICAgdGhpcy5vcHRpb25zID0gJC5leHRlbmQodHJ1ZSwge30sIGRlZmF1bHRzLCBvcHRpb25zKTtcblxuICAgIGlmICh0aGlzLm9wdGlvbnMucnVuIGluc3RhbmNlb2YgUnVuU2VydmljZSkge1xuICAgICAgICB0aGlzLnJ1biA9IHRoaXMub3B0aW9ucy5ydW47XG4gICAgfSBlbHNlIHtcbiAgICAgICAgdGhpcy5ydW4gPSBuZXcgUnVuU2VydmljZSh0aGlzLm9wdGlvbnMucnVuKTtcbiAgICB9XG5cbiAgICBwYXRjaFJ1blNlcnZpY2UodGhpcy5ydW4sIHRoaXMpO1xuXG4gICAgdmFyIFN0cmF0ZWd5Q3RvciA9IHR5cGVvZiB0aGlzLm9wdGlvbnMuc3RyYXRlZ3kgPT09ICdmdW5jdGlvbicgPyB0aGlzLm9wdGlvbnMuc3RyYXRlZ3kgOiBzdHJhdGVnaWVzTWFwW3RoaXMub3B0aW9ucy5zdHJhdGVneV07XG5cbiAgICBpZiAoIVN0cmF0ZWd5Q3Rvcikge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ1NwZWNpZmllZCBydW4gY3JlYXRpb24gc3RyYXRlZ3kgd2FzIGludmFsaWQ6JywgdGhpcy5vcHRpb25zLnN0cmF0ZWd5KTtcbiAgICB9XG5cbiAgICB0aGlzLnN0cmF0ZWd5ID0gbmV3IFN0cmF0ZWd5Q3Rvcih0aGlzLnJ1biwgdGhpcy5vcHRpb25zKTtcbn1cblxuUnVuTWFuYWdlci5wcm90b3R5cGUgPSB7XG4gICAgLyoqXG4gICAgICogUmV0dXJucyB0aGUgcnVuIG9iamVjdCBmb3IgYSAnZ29vZCcgcnVuLlxuICAgICAqXG4gICAgICogQSBnb29kIHJ1biBpcyBkZWZpbmVkIGJ5IHRoZSBzdHJhdGVneS4gRm9yIGV4YW1wbGUsIGlmIHRoZSBzdHJhdGVneSBpcyBgYWx3YXlzLW5ld2AsIHRoZSBjYWxsXG4gICAgICogdG8gYGdldFJ1bigpYCBhbHdheXMgcmV0dXJucyBhIG5ld2x5IGNyZWF0ZWQgcnVuOyBpZiB0aGUgc3RyYXRlZ3kgaXMgYG5ldy1pZi1wZXJzaXN0ZWRgLFxuICAgICAqIGBnZXRSdW4oKWAgY3JlYXRlcyBhIG5ldyBydW4gaWYgdGhlIHByZXZpb3VzIHJ1biBpcyBpbiBhIHBlcnNpc3RlZCBzdGF0ZSwgb3RoZXJ3aXNlXG4gICAgICogaXQgcmV0dXJucyB0aGUgcHJldmlvdXMgcnVuLiBTZWUgW1J1biBNYW5hZ2VyIFN0cmF0ZWdpZXNdKC4uLy4uL3N0cmF0ZWd5LykgZm9yIG1vcmUgb24gc3RyYXRlZ2llcy5cbiAgICAgKlxuICAgICAqICAqKkV4YW1wbGUqKlxuICAgICAqXG4gICAgICogICAgICBybS5nZXRSdW4oKS50aGVuKGZ1bmN0aW9uIChydW4pIHtcbiAgICAgKiAgICAgICAgICAvLyB1c2UgdGhlIHJ1biBvYmplY3RcbiAgICAgKiAgICAgICAgICB2YXIgdGhpc1J1bklkID0gcnVuLmlkO1xuICAgICAqXG4gICAgICogICAgICAgICAgLy8gdXNlIHRoZSBSdW4gU2VydmljZSBvYmplY3RcbiAgICAgKiAgICAgICAgICBydW4uZG8oJ3J1bk1vZGVsJyk7XG4gICAgICogICAgICB9KTtcbiAgICAgKlxuICAgICAqICoqUGFyYW1ldGVycyoqXG4gICAgICogQHBhcmFtIHtOb25lfSBOb25lXG4gICAgICovXG4gICAgZ2V0UnVuOiBmdW5jdGlvbiAoKSB7XG4gICAgICAgIHJldHVybiB0aGlzLnN0cmF0ZWd5XG4gICAgICAgICAgICAgICAgLmdldFJ1bigpO1xuICAgIH0sXG5cbiAgICAvKipcbiAgICAgKiBSZXR1cm5zIHRoZSBydW4gb2JqZWN0IGZvciBhIG5ldyBydW4sIHJlZ2FyZGxlc3Mgb2Ygc3RyYXRlZ3k6IGZvcmNlIGNyZWF0aW9uIG9mIGEgbmV3IHJ1bi5cbiAgICAgKlxuICAgICAqICAqKkV4YW1wbGUqKlxuICAgICAqXG4gICAgICogICAgICBybS5yZXNldCgpLnRoZW4oZnVuY3Rpb24gKHJ1bikge1xuICAgICAqICAgICAgICAgIC8vIHVzZSB0aGUgKG5ldykgcnVuIG9iamVjdFxuICAgICAqICAgICAgICAgIHZhciB0aGlzUnVuSWQgPSBydW4uaWQ7XG4gICAgICogICAgICAgICAgLy8gdXNlIHRoZSBSdW4gU2VydmljZSBvYmplY3RcbiAgICAgKiAgICAgICAgICBydW4uZG8oJ3J1bk1vZGVsJyk7XG4gICAgICogICAgICB9KTtcbiAgICAgKlxuICAgICAqICoqUGFyYW1ldGVycyoqXG4gICAgICogQHBhcmFtIHtPYmplY3R9IGBydW5TZXJ2aWNlT3B0aW9uc2AgVGhlIG9wdGlvbnMgb2JqZWN0IHRvIGNvbmZpZ3VyZSB0aGUgUnVuIFNlcnZpY2UuIFNlZSBbUnVuIEFQSSBTZXJ2aWNlXSguLi9ydW4tYXBpLXNlcnZpY2UvKSBmb3IgbW9yZS5cbiAgICAgKi9cbiAgICByZXNldDogZnVuY3Rpb24gKHJ1blNlcnZpY2VPcHRpb25zKSB7XG4gICAgICAgIHJldHVybiB0aGlzLnN0cmF0ZWd5LnJlc2V0KHJ1blNlcnZpY2VPcHRpb25zKTtcbiAgICB9XG59O1xuXG5tb2R1bGUuZXhwb3J0cyA9IFJ1bk1hbmFnZXI7XG4iLCIndXNlIHN0cmljdCc7XG5cbnZhciBjbGFzc0Zyb20gPSByZXF1aXJlKCcuLi8uLi91dGlsL2luaGVyaXQnKTtcbnZhciBDb25kaXRpb25hbFN0cmF0ZWd5ID0gcmVxdWlyZSgnLi9jb25kaXRpb25hbC1jcmVhdGlvbi1zdHJhdGVneScpO1xuXG52YXIgX19zdXBlciA9IENvbmRpdGlvbmFsU3RyYXRlZ3kucHJvdG90eXBlO1xuXG52YXIgU3RyYXRlZ3kgPSBjbGFzc0Zyb20oQ29uZGl0aW9uYWxTdHJhdGVneSwge1xuICAgIGNvbnN0cnVjdG9yOiBmdW5jdGlvbiAocnVuU2VydmljZSwgb3B0aW9ucykge1xuICAgICAgICBfX3N1cGVyLmNvbnN0cnVjdG9yLmNhbGwodGhpcywgcnVuU2VydmljZSwgdGhpcy5jcmVhdGVJZiwgb3B0aW9ucyk7XG4gICAgfSxcblxuICAgIGNyZWF0ZUlmOiBmdW5jdGlvbiAocnVuLCBoZWFkZXJzKSB7XG4gICAgICAgIC8vIGFsd2F5cyBjcmVhdGUgYSBuZXcgcnVuIVxuICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICB9XG59KTtcblxubW9kdWxlLmV4cG9ydHMgPSBTdHJhdGVneTtcbiIsIid1c2Ugc3RyaWN0JztcblxudmFyIG1ha2VTZXEgPSByZXF1aXJlKCcuLi8uLi91dGlsL21ha2Utc2VxdWVuY2UnKTtcbnZhciBCYXNlID0gcmVxdWlyZSgnLi9pZGVudGl0eS1zdHJhdGVneScpO1xudmFyIFNlc3Npb25TdG9yZSA9IHJlcXVpcmUoJy4uLy4uL3N0b3JlL3N0b3JlLWZhY3RvcnknKTtcbnZhciBjbGFzc0Zyb20gPSByZXF1aXJlKCcuLi8uLi91dGlsL2luaGVyaXQnKTtcbnZhciBVcmxTZXJ2aWNlID0gcmVxdWlyZSgnLi4vLi4vc2VydmljZS91cmwtY29uZmlnLXNlcnZpY2UnKTtcbnZhciBBdXRoTWFuYWdlciA9IHJlcXVpcmUoJy4uL2F1dGgtbWFuYWdlcicpO1xuXG52YXIgc2Vzc2lvblN0b3JlID0gbmV3IFNlc3Npb25TdG9yZSh7fSk7XG52YXIgdXJsU2VydmljZSA9IG5ldyBVcmxTZXJ2aWNlKCk7XG52YXIga2V5TmFtZXMgPSByZXF1aXJlKCcuLi9rZXktbmFtZXMnKTtcblxudmFyIGRlZmF1bHRzID0ge1xuICAgIHNlc3Npb25LZXk6IGtleU5hbWVzLlNUUkFURUdZX1NFU1NJT05fS0VZXG59O1xuXG5mdW5jdGlvbiBzZXRSdW5JblNlc3Npb24oc2Vzc2lvbktleSwgcnVuKSB7XG4gICAgdmFyIHBhdGggPSAnLycgKyBbdXJsU2VydmljZS5hcHBQYXRoLCB1cmxTZXJ2aWNlLmFjY291bnRQYXRoLCB1cmxTZXJ2aWNlLnByb2plY3RQYXRoXS5qb2luKCcvJyk7XG5cbiAgICAvLyBtYWtlIHN1cmUgd2UgZG9uJ3QgZ2V0IGNvbnNlY3V0ZWl2ZSAnLycgc28gd2UgaGF2ZSBhIHZhbGlkIHBhdGggZm9yIHRoZSBzZXNzaW9uXG4gICAgcGF0aCA9IHBhdGgucmVwbGFjZSgvXFwvezIsfS9nLCcvJyk7XG5cbiAgICAvLyBzZXQgdGhlIHNlZXNpb25LZXkgZm9yIHRoZSBydW5cbiAgICBzZXNzaW9uU3RvcmUuc2V0KHNlc3Npb25LZXksIEpTT04uc3RyaW5naWZ5KHsgcnVuSWQ6IHJ1bi5pZCB9KSwgeyByb290OiBwYXRoIH0pO1xufVxuXG4vKipcbiogQ29uZGl0aW9uYWwgQ3JlYXRpb24gU3RyYXRlZ3lcbiogVGhpcyBzdHJhdGVneSB3aWxsIHRyeSB0byBnZXQgdGhlIHJ1biBzdG9yZWQgaW4gdGhlIGNvb2tpZSBhbmRcbiogZXZhbHVhdGUgaWYgbmVlZHMgdG8gY3JlYXRlIGEgbmV3IHJ1biBieSBjYWxsaW5nIHRoZSAnY29uZGl0aW9uJyBmdW5jdGlvblxuKi9cblxuLyoganNoaW50IGVxbnVsbDogdHJ1ZSAqL1xudmFyIFN0cmF0ZWd5ID0gY2xhc3NGcm9tKEJhc2UsIHtcbiAgICBjb25zdHJ1Y3RvcjogZnVuY3Rpb24gU3RyYXRlZ3kocnVuU2VydmljZSwgY29uZGl0aW9uLCBvcHRpb25zKSB7XG5cbiAgICAgICAgaWYgKGNvbmRpdGlvbiA9PSBudWxsKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ0NvbmRpdGlvbmFsIHN0cmF0ZWd5IG5lZWRzIGEgY29uZGl0aW9uIHRvIGNyZWF0ZXRlIGEgcnVuJyk7XG4gICAgICAgIH1cblxuICAgICAgICB0aGlzLl9hdXRoID0gbmV3IEF1dGhNYW5hZ2VyKCk7XG4gICAgICAgIHRoaXMucnVuID0gbWFrZVNlcShydW5TZXJ2aWNlKTtcbiAgICAgICAgdGhpcy5jb25kaXRpb24gPSB0eXBlb2YgY29uZGl0aW9uICE9PSAnZnVuY3Rpb24nID8gZnVuY3Rpb24gKCkgeyByZXR1cm4gY29uZGl0aW9uOyB9IDogY29uZGl0aW9uO1xuICAgICAgICB0aGlzLm9wdGlvbnMgPSAkLmV4dGVuZCh0cnVlLCB7fSwgZGVmYXVsdHMsIG9wdGlvbnMpO1xuICAgICAgICB0aGlzLnJ1bk9wdGlvbnMgPSB0aGlzLm9wdGlvbnMucnVuO1xuICAgIH0sXG5cbiAgICByZXNldDogZnVuY3Rpb24gKHJ1blNlcnZpY2VPcHRpb25zKSB7XG4gICAgICAgIHZhciBfdGhpcyA9IHRoaXM7XG4gICAgICAgIHZhciBzZXNzaW9uID0gdGhpcy5fYXV0aC5nZXRDdXJyZW50VXNlclNlc3Npb25JbmZvKCk7XG4gICAgICAgIHZhciBvcHQgPSAkLmV4dGVuZCh7XG4gICAgICAgICAgICBzY29wZTogeyBncm91cDogc2Vzc2lvbi5ncm91cElkIH1cbiAgICAgICAgfSwgdGhpcy5ydW5PcHRpb25zKTtcblxuICAgICAgICByZXR1cm4gdGhpcy5ydW5cbiAgICAgICAgICAgICAgICAuY3JlYXRlKG9wdCwgcnVuU2VydmljZU9wdGlvbnMpXG4gICAgICAgICAgICAudGhlbihmdW5jdGlvbiAocnVuKSB7XG4gICAgICAgICAgICAgICAgc2V0UnVuSW5TZXNzaW9uKF90aGlzLm9wdGlvbnMuc2Vzc2lvbktleSwgcnVuKTtcbiAgICAgICAgICAgICAgICBydW4uZnJlc2hseUNyZWF0ZWQgPSB0cnVlO1xuICAgICAgICAgICAgICAgIHJldHVybiBydW47XG4gICAgICAgICAgICB9KVxuICAgICAgICAgICAgLnN0YXJ0KCk7XG4gICAgfSxcblxuICAgIGdldFJ1bjogZnVuY3Rpb24gKCkge1xuICAgICAgICB2YXIgc2Vzc2lvbiA9IHRoaXMuX2F1dGguZ2V0Q3VycmVudFVzZXJTZXNzaW9uSW5mbygpO1xuXG4gICAgICAgIGlmIChzZXNzaW9uICYmIHNlc3Npb24ucnVuSWQpIHtcbiAgICAgICAgICAgIHJldHVybiB0aGlzLl9sb2FkQW5kQ2hlY2soc2Vzc2lvbik7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICByZXR1cm4gdGhpcy5yZXNldCgpO1xuICAgICAgICB9XG4gICAgfSxcblxuICAgIF9sb2FkQW5kQ2hlY2s6IGZ1bmN0aW9uIChzZXNzaW9uKSB7XG4gICAgICAgIHZhciBzaG91bGRDcmVhdGUgPSBmYWxzZTtcbiAgICAgICAgdmFyIF90aGlzID0gdGhpcztcblxuICAgICAgICByZXR1cm4gdGhpcy5ydW5cbiAgICAgICAgICAgIC5sb2FkKHNlc3Npb24ucnVuSWQsIG51bGwsIHtcbiAgICAgICAgICAgICAgICBzdWNjZXNzOiBmdW5jdGlvbiAocnVuLCBtc2csIGhlYWRlcnMpIHtcbiAgICAgICAgICAgICAgICAgICAgc2hvdWxkQ3JlYXRlID0gX3RoaXMuY29uZGl0aW9uLmNhbGwoX3RoaXMsIHJ1biwgaGVhZGVycyk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSlcbiAgICAgICAgICAgIC50aGVuKGZ1bmN0aW9uIChydW4pIHtcbiAgICAgICAgICAgICAgICBpZiAoc2hvdWxkQ3JlYXRlKSB7XG4gICAgICAgICAgICAgICAgICAgIC8vIHdlIG5lZWQgdG8gZG8gdGhpcywgb24gdGhlIG9yaWdpbmFsIHJ1blNlcnZpY2UgKGllIG5vdCBzZXF1ZW5jaWFsaXplZClcbiAgICAgICAgICAgICAgICAgICAgLy8gc28gd2UgZG9uJ3QgZ2V0IGluIHRoZSBtaWRkbGUgb2YgdGhlIHF1ZXVlXG4gICAgICAgICAgICAgICAgICAgIHJldHVybiBfdGhpcy5ydW4ub3JpZ2luYWwuY3JlYXRlKF90aGlzLnJ1bk9wdGlvbnMpXG4gICAgICAgICAgICAgICAgICAgIC50aGVuKGZ1bmN0aW9uIChydW4pIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHNldFJ1bkluU2Vzc2lvbihfdGhpcy5vcHRpb25zLnNlc3Npb25LZXksIHJ1bik7XG4gICAgICAgICAgICAgICAgICAgICAgICBydW4uZnJlc2hseUNyZWF0ZWQgPSB0cnVlO1xuICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuIHJ1bjtcbiAgICAgICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgcmV0dXJuIHJ1bjtcbiAgICAgICAgICAgIH0pXG4gICAgICAgICAgICAuc3RhcnQoKTtcbiAgICB9XG59KTtcblxubW9kdWxlLmV4cG9ydHMgPSBTdHJhdGVneTtcbiIsIid1c2Ugc3RyaWN0JztcblxudmFyIGNsYXNzRnJvbSA9IHJlcXVpcmUoJy4uLy4uL3V0aWwvaW5oZXJpdCcpO1xudmFyIEJhc2UgPSB7fTtcblxuLy8gSW50ZXJmYWNlIHRoYXQgYWxsIHN0cmF0ZWdpZXMgbmVlZCB0byBpbXBsZW1lbnRcbm1vZHVsZS5leHBvcnRzID0gY2xhc3NGcm9tKEJhc2UsIHtcbiAgICBjb25zdHJ1Y3RvcjogZnVuY3Rpb24gKHJ1blNlcnZpY2UsIG9wdGlvbnMpIHtcbiAgICAgICAgdGhpcy5ydW5TZXJ2aWNlICA9IHJ1blNlcnZpY2U7XG4gICAgfSxcblxuICAgIHJlc2V0OiBmdW5jdGlvbiAoKSB7XG4gICAgICAgIC8vIHJldHVybiBhIG5ld2x5IGNyZWF0ZWQgcnVuXG4gICAgICAgIHJldHVybiAkLkRlZmVycmVkKCkucmVzb2x2ZSgpLnByb21pc2UoKTtcbiAgICB9LFxuXG4gICAgZ2V0UnVuOiBmdW5jdGlvbiAoKSB7XG4gICAgICAgIC8vIHJldHVybiBhIHVzYWJsZSBydW5cbiAgICAgICAgcmV0dXJuICQuRGVmZXJyZWQoKS5yZXNvbHZlKHRoaXMucnVuU2VydmljZSkucHJvbWlzZSgpO1xuICAgIH1cbn0pO1xuIiwiJ3VzZSBzdHJpY3QnO1xuXG52YXIgY2xhc3NGcm9tID0gcmVxdWlyZSgnLi4vLi4vdXRpbC9pbmhlcml0Jyk7XG5cbnZhciBJZGVudGl0eVN0cmF0ZWd5ID0gcmVxdWlyZSgnLi9pZGVudGl0eS1zdHJhdGVneScpO1xudmFyIFdvcmxkQXBpQWRhcHRlciA9IHJlcXVpcmUoJy4uLy4uL3NlcnZpY2Uvd29ybGQtYXBpLWFkYXB0ZXInKTtcbnZhciBBdXRoTWFuYWdlciA9IHJlcXVpcmUoJy4uL2F1dGgtbWFuYWdlcicpO1xuXG52YXIgZGVmYXVsdHMgPSB7XG4gICAgc3RvcmU6IHtcbiAgICAgICAgc3luY2hyb25vdXM6IHRydWVcbiAgICB9XG59O1xuXG52YXIgU3RyYXRlZ3kgPSBjbGFzc0Zyb20oSWRlbnRpdHlTdHJhdGVneSwge1xuXG4gICAgY29uc3RydWN0b3I6IGZ1bmN0aW9uIChydW5TZXJ2aWNlLCBvcHRpb25zKSB7XG4gICAgICAgIHRoaXMucnVuU2VydmljZSA9IHJ1blNlcnZpY2U7XG4gICAgICAgIHRoaXMub3B0aW9ucyA9ICQuZXh0ZW5kKHRydWUsIHt9LCBkZWZhdWx0cywgb3B0aW9ucyk7XG4gICAgICAgIHRoaXMuX2F1dGggPSBuZXcgQXV0aE1hbmFnZXIoKTtcbiAgICAgICAgdGhpcy5fbG9hZFJ1biA9IHRoaXMuX2xvYWRSdW4uYmluZCh0aGlzKTtcbiAgICAgICAgdGhpcy53b3JsZEFwaSA9IG5ldyBXb3JsZEFwaUFkYXB0ZXIodGhpcy5vcHRpb25zLnJ1bik7XG4gICAgfSxcblxuICAgIHJlc2V0OiBmdW5jdGlvbiAoKSB7XG4gICAgICAgIHZhciBzZXNzaW9uID0gdGhpcy5fYXV0aC5nZXRDdXJyZW50VXNlclNlc3Npb25JbmZvKCk7XG4gICAgICAgIHZhciBjdXJVc2VySWQgPSBzZXNzaW9uLnVzZXJJZDtcbiAgICAgICAgdmFyIGN1ckdyb3VwTmFtZSA9IHNlc3Npb24uZ3JvdXBOYW1lO1xuXG4gICAgICAgIHJldHVybiB0aGlzLndvcmxkQXBpXG4gICAgICAgICAgICAuZ2V0Q3VycmVudFdvcmxkRm9yVXNlcihjdXJVc2VySWQsIGN1ckdyb3VwTmFtZSlcbiAgICAgICAgICAgIC50aGVuKGZ1bmN0aW9uICh3b3JsZCkge1xuICAgICAgICAgICAgICAgIHJldHVybiB0aGlzLndvcmxkQXBpLm5ld1J1bkZvcldvcmxkKHdvcmxkLmlkKTtcbiAgICAgICAgICAgIH0uYmluZCh0aGlzKSk7XG4gICAgfSxcblxuICAgIGdldFJ1bjogZnVuY3Rpb24gKCkge1xuICAgICAgICB2YXIgc2Vzc2lvbiA9IHRoaXMuX2F1dGguZ2V0Q3VycmVudFVzZXJTZXNzaW9uSW5mbygpO1xuICAgICAgICB2YXIgY3VyVXNlcklkID0gc2Vzc2lvbi51c2VySWQ7XG4gICAgICAgIHZhciBjdXJHcm91cE5hbWUgPSBzZXNzaW9uLmdyb3VwTmFtZTtcbiAgICAgICAgdmFyIHdvcmxkQXBpID0gdGhpcy53b3JsZEFwaTtcbiAgICAgICAgdmFyIG1vZGVsID0gdGhpcy5vcHRpb25zLm1vZGVsO1xuICAgICAgICB2YXIgX3RoaXMgPSB0aGlzO1xuICAgICAgICB2YXIgZHRkID0gJC5EZWZlcnJlZCgpO1xuXG4gICAgICAgIGlmICghY3VyVXNlcklkKSB7XG4gICAgICAgICAgICByZXR1cm4gZHRkLnJlamVjdCh7IHN0YXR1c0NvZGU6IDQwMCwgZXJyb3I6ICdXZSBuZWVkIGFuIGF1dGhlbnRpY2F0ZWQgdXNlciB0byBqb2luIGEgbXVsdGlwbGF5ZXIgd29ybGQuIChFUlI6IG5vIHVzZXJJZCBpbiBzZXNzaW9uKScgfSwgc2Vzc2lvbikucHJvbWlzZSgpO1xuICAgICAgICB9XG5cbiAgICAgICAgdmFyIGxvYWRSdW5Gcm9tV29ybGQgPSBmdW5jdGlvbiAod29ybGQpIHtcbiAgICAgICAgICAgIGlmICghd29ybGQpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gZHRkLnJlamVjdCh7IHN0YXR1c0NvZGU6IDQwNCwgZXJyb3I6ICdUaGUgdXNlciBpcyBub3QgaW4gYW55IHdvcmxkLicgfSwgeyBvcHRpb25zOiB0aGlzLm9wdGlvbnMsIHNlc3Npb246IHNlc3Npb24gfSk7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIHJldHVybiB3b3JsZEFwaS5nZXRDdXJyZW50UnVuSWQoeyBtb2RlbDogbW9kZWwsIGZpbHRlcjogd29ybGQuaWQgfSlcbiAgICAgICAgICAgICAgICAudGhlbihfdGhpcy5fbG9hZFJ1bilcbiAgICAgICAgICAgICAgICAudGhlbihkdGQucmVzb2x2ZSlcbiAgICAgICAgICAgICAgICAuZmFpbChkdGQucmVqZWN0KTtcbiAgICAgICAgfTtcblxuICAgICAgICB2YXIgc2VydmVyRXJyb3IgPSBmdW5jdGlvbiAoZXJyb3IpIHtcbiAgICAgICAgICAgIC8vIGlzIHRoaXMgcG9zc2libGU/XG4gICAgICAgICAgICBkdGQucmVqZWN0KGVycm9yLCBzZXNzaW9uLCB0aGlzLm9wdGlvbnMpO1xuICAgICAgICB9O1xuXG4gICAgICAgIHRoaXMud29ybGRBcGlcbiAgICAgICAgICAgIC5nZXRDdXJyZW50V29ybGRGb3JVc2VyKGN1clVzZXJJZCwgY3VyR3JvdXBOYW1lKVxuICAgICAgICAgICAgLnRoZW4obG9hZFJ1bkZyb21Xb3JsZClcbiAgICAgICAgICAgIC5mYWlsKHNlcnZlckVycm9yKTtcblxuICAgICAgICByZXR1cm4gZHRkLnByb21pc2UoKTtcbiAgICB9LFxuXG4gICAgX2xvYWRSdW46IGZ1bmN0aW9uIChpZCwgb3B0aW9ucykge1xuICAgICAgICByZXR1cm4gdGhpcy5ydW5TZXJ2aWNlLmxvYWQoaWQsIG51bGwsIG9wdGlvbnMpO1xuICAgIH1cbn0pO1xuXG5tb2R1bGUuZXhwb3J0cyA9IFN0cmF0ZWd5O1xuIiwiJ3VzZSBzdHJpY3QnO1xudmFyIGNsYXNzRnJvbSA9IHJlcXVpcmUoJy4uLy4uL3V0aWwvaW5oZXJpdCcpO1xudmFyIENvbmRpdGlvbmFsU3RyYXRlZ3kgPSByZXF1aXJlKCcuL2NvbmRpdGlvbmFsLWNyZWF0aW9uLXN0cmF0ZWd5Jyk7XG5cbnZhciBfX3N1cGVyID0gQ29uZGl0aW9uYWxTdHJhdGVneS5wcm90b3R5cGU7XG5cbnZhciBTdHJhdGVneSA9IGNsYXNzRnJvbShDb25kaXRpb25hbFN0cmF0ZWd5LCB7XG4gICAgY29uc3RydWN0b3I6IGZ1bmN0aW9uIChydW5TZXJ2aWNlLCBvcHRpb25zKSB7XG4gICAgICAgIF9fc3VwZXIuY29uc3RydWN0b3IuY2FsbCh0aGlzLCBydW5TZXJ2aWNlLCB0aGlzLmNyZWF0ZUlmLCBvcHRpb25zKTtcbiAgICB9LFxuXG4gICAgY3JlYXRlSWY6IGZ1bmN0aW9uIChydW4sIGhlYWRlcnMpIHtcbiAgICAgICAgcmV0dXJuIGhlYWRlcnMuZ2V0UmVzcG9uc2VIZWFkZXIoJ3ByYWdtYScpID09PSAncGVyc2lzdGVudCcgfHwgcnVuLmluaXRpYWxpemVkO1xuICAgIH1cbn0pO1xuXG5tb2R1bGUuZXhwb3J0cyA9IFN0cmF0ZWd5O1xuIiwiJ3VzZSBzdHJpY3QnO1xuXG52YXIgY2xhc3NGcm9tID0gcmVxdWlyZSgnLi4vLi4vdXRpbC9pbmhlcml0Jyk7XG52YXIgQ29uZGl0aW9uYWxTdHJhdGVneSA9IHJlcXVpcmUoJy4vY29uZGl0aW9uYWwtY3JlYXRpb24tc3RyYXRlZ3knKTtcblxudmFyIF9fc3VwZXIgPSBDb25kaXRpb25hbFN0cmF0ZWd5LnByb3RvdHlwZTtcblxuLypcbiogIGNyZWF0ZSBhIG5ldyBydW4gb25seSBpZiBub3RoaW5nIGlzIHN0b3JlZCBpbiB0aGUgY29va2llXG4qICB0aGlzIGlzIHVzZWZ1bCBmb3IgYmFzZVJ1bnMuXG4qL1xudmFyIFN0cmF0ZWd5ID0gY2xhc3NGcm9tKENvbmRpdGlvbmFsU3RyYXRlZ3ksIHtcbiAgICBjb25zdHJ1Y3RvcjogZnVuY3Rpb24gKHJ1blNlcnZpY2UsIG9wdGlvbnMpIHtcbiAgICAgICAgX19zdXBlci5jb25zdHJ1Y3Rvci5jYWxsKHRoaXMsIHJ1blNlcnZpY2UsIHRoaXMuY3JlYXRlSWYsIG9wdGlvbnMpO1xuICAgIH0sXG5cbiAgICBjcmVhdGVJZjogZnVuY3Rpb24gKHJ1biwgaGVhZGVycykge1xuICAgICAgICAvLyBpZiB3ZSBhcmUgaGVyZSwgaXQgbWVhbnMgdGhhdCB0aGUgcnVuIGV4aXN0cy4uLiBzbyB3ZSBkb24ndCBuZWVkIGEgbmV3IG9uZVxuICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgfVxufSk7XG5cbm1vZHVsZS5leHBvcnRzID0gU3RyYXRlZ3k7XG4iLCIndXNlIHN0cmljdCc7XG52YXIgY2xhc3NGcm9tID0gcmVxdWlyZSgnLi4vLi4vdXRpbC9pbmhlcml0Jyk7XG52YXIgQ29uZGl0aW9uYWxTdHJhdGVneSA9IHJlcXVpcmUoJy4vY29uZGl0aW9uYWwtY3JlYXRpb24tc3RyYXRlZ3knKTtcblxudmFyIF9fc3VwZXIgPSBDb25kaXRpb25hbFN0cmF0ZWd5LnByb3RvdHlwZTtcblxudmFyIFN0cmF0ZWd5ID0gY2xhc3NGcm9tKENvbmRpdGlvbmFsU3RyYXRlZ3ksIHtcbiAgICBjb25zdHJ1Y3RvcjogZnVuY3Rpb24gKHJ1blNlcnZpY2UsIG9wdGlvbnMpIHtcbiAgICAgICAgX19zdXBlci5jb25zdHJ1Y3Rvci5jYWxsKHRoaXMsIHJ1blNlcnZpY2UsIHRoaXMuY3JlYXRlSWYsIG9wdGlvbnMpO1xuICAgIH0sXG5cbiAgICBjcmVhdGVJZjogZnVuY3Rpb24gKHJ1biwgaGVhZGVycykge1xuICAgICAgICByZXR1cm4gaGVhZGVycy5nZXRSZXNwb25zZUhlYWRlcigncHJhZ21hJykgPT09ICdwZXJzaXN0ZW50JztcbiAgICB9XG59KTtcblxubW9kdWxlLmV4cG9ydHMgPSBTdHJhdGVneTtcbiIsIid1c2Ugc3RyaWN0JztcblxudmFyIGNsYXNzRnJvbSA9IHJlcXVpcmUoJy4uLy4uL3V0aWwvaW5oZXJpdCcpO1xudmFyIElkZW50aXR5U3RyYXRlZ3kgPSByZXF1aXJlKCcuL2lkZW50aXR5LXN0cmF0ZWd5Jyk7XG52YXIgU3RvcmFnZUZhY3RvcnkgPSByZXF1aXJlKCcuLi8uLi9zdG9yZS9zdG9yZS1mYWN0b3J5Jyk7XG52YXIgU3RhdGVBcGkgPSByZXF1aXJlKCcuLi8uLi9zZXJ2aWNlL3N0YXRlLWFwaS1hZGFwdGVyJyk7XG5cbnZhciBrZXlOYW1lcyA9IHJlcXVpcmUoJy4uL2tleS1uYW1lcycpO1xuXG52YXIgZGVmYXVsdHMgPSB7XG4gICAgc3RvcmU6IHtcbiAgICAgICAgc3luY2hyb25vdXM6IHRydWVcbiAgICB9XG59O1xuXG52YXIgU3RyYXRlZ3kgPSBjbGFzc0Zyb20oSWRlbnRpdHlTdHJhdGVneSwge1xuICAgIGNvbnN0cnVjdG9yOiBmdW5jdGlvbiBTdHJhdGVneShydW5TZXJ2aWNlLCBvcHRpb25zKSB7XG4gICAgICAgIHRoaXMucnVuID0gcnVuU2VydmljZTtcbiAgICAgICAgdGhpcy5vcHRpb25zID0gJC5leHRlbmQodHJ1ZSwge30sIGRlZmF1bHRzLCBvcHRpb25zKTtcbiAgICAgICAgdGhpcy5ydW5PcHRpb25zID0gdGhpcy5vcHRpb25zLnJ1bjtcbiAgICAgICAgdGhpcy5fc3RvcmUgPSBuZXcgU3RvcmFnZUZhY3RvcnkodGhpcy5vcHRpb25zLnN0b3JlKTtcbiAgICAgICAgdGhpcy5zdGF0ZUFwaSA9IG5ldyBTdGF0ZUFwaSgpO1xuXG4gICAgICAgIHRoaXMuX2xvYWRBbmRDaGVjayA9IHRoaXMuX2xvYWRBbmRDaGVjay5iaW5kKHRoaXMpO1xuICAgICAgICB0aGlzLl9yZXN0b3JlUnVuID0gdGhpcy5fcmVzdG9yZVJ1bi5iaW5kKHRoaXMpO1xuICAgICAgICB0aGlzLl9nZXRBbGxSdW5zID0gdGhpcy5fZ2V0QWxsUnVucy5iaW5kKHRoaXMpO1xuICAgICAgICB0aGlzLl9sb2FkUnVuID0gdGhpcy5fbG9hZFJ1bi5iaW5kKHRoaXMpO1xuICAgIH0sXG5cbiAgICByZXNldDogZnVuY3Rpb24gKHJ1blNlcnZpY2VPcHRpb25zKSB7XG4gICAgICAgIHZhciBzZXNzaW9uID0gdGhpcy5fYXV0aC5nZXRDdXJyZW50VXNlclNlc3Npb25JbmZvKCk7XG4gICAgICAgIHZhciBvcHQgPSAkLmV4dGVuZCh7XG4gICAgICAgICAgICBzY29wZTogeyBncm91cDogc2Vzc2lvbi5ncm91cElkIH1cbiAgICAgICAgfSwgdGhpcy5ydW5PcHRpb25zKTtcblxuICAgICAgICByZXR1cm4gdGhpcy5ydW5cbiAgICAgICAgICAgIC5jcmVhdGUob3B0LCBydW5TZXJ2aWNlT3B0aW9ucylcbiAgICAgICAgICAgIC50aGVuKGZ1bmN0aW9uIChydW4pIHtcbiAgICAgICAgICAgICAgICBydW4uZnJlc2hseUNyZWF0ZWQgPSB0cnVlO1xuICAgICAgICAgICAgICAgIHJldHVybiBydW47XG4gICAgICAgICAgICB9KTtcbiAgICB9LFxuXG4gICAgZ2V0UnVuOiBmdW5jdGlvbiAoKSB7XG4gICAgICAgIHJldHVybiB0aGlzLl9nZXRBbGxSdW5zKClcbiAgICAgICAgICAgIC50aGVuKHRoaXMuX2xvYWRBbmRDaGVjayk7XG4gICAgfSxcblxuICAgIF9nZXRBbGxSdW5zOiBmdW5jdGlvbiAoKSB7XG4gICAgICAgIHZhciBzZXNzaW9uID0gSlNPTi5wYXJzZSh0aGlzLl9zdG9yZS5nZXQoa2V5TmFtZXMuRVBJX1NFU1NJT05fS0VZKSB8fCAne30nKTtcbiAgICAgICAgcmV0dXJuIHRoaXMucnVuLnF1ZXJ5KHtcbiAgICAgICAgICAgICd1c2VyLmlkJzogc2Vzc2lvbi51c2VySWQgfHwgJzAwMDAnLFxuICAgICAgICAgICAgJ3Njb3BlLmdyb3VwJzogc2Vzc2lvbi5ncm91cE5hbWVcbiAgICAgICAgfSk7XG4gICAgfSxcblxuICAgIF9sb2FkQW5kQ2hlY2s6IGZ1bmN0aW9uIChydW5zKSB7XG4gICAgICAgIGlmICghcnVucyB8fCAhcnVucy5sZW5ndGgpIHtcbiAgICAgICAgICAgIHJldHVybiB0aGlzLnJlc2V0KCk7XG4gICAgICAgIH1cblxuICAgICAgICB2YXIgZGF0ZUNvbXAgPSBmdW5jdGlvbiAoYSwgYikgeyByZXR1cm4gbmV3IERhdGUoYi5kYXRlKSAtIG5ldyBEYXRlKGEuZGF0ZSk7IH07XG4gICAgICAgIHZhciBsYXRlc3RSdW4gPSBydW5zLnNvcnQoZGF0ZUNvbXApWzBdO1xuICAgICAgICB2YXIgX3RoaXMgPSB0aGlzO1xuICAgICAgICB2YXIgc2hvdWxkUmVwbGF5ID0gZmFsc2U7XG5cbiAgICAgICAgcmV0dXJuIHRoaXMucnVuLmxvYWQobGF0ZXN0UnVuLmlkLCBudWxsLCB7XG4gICAgICAgICAgICBzdWNjZXNzOiBmdW5jdGlvbiAocnVuLCBtc2csIGhlYWRlcnMpIHtcbiAgICAgICAgICAgICAgICBzaG91bGRSZXBsYXkgPSBoZWFkZXJzLmdldFJlc3BvbnNlSGVhZGVyKCdwcmFnbWEnKSA9PT0gJ3BlcnNpc3RlbnQnO1xuICAgICAgICAgICAgfVxuICAgICAgICB9KS50aGVuKGZ1bmN0aW9uIChydW4pIHtcbiAgICAgICAgICAgIHJldHVybiBzaG91bGRSZXBsYXkgPyBfdGhpcy5fcmVzdG9yZVJ1bihydW4uaWQpIDogcnVuO1xuICAgICAgICB9KTtcbiAgICB9LFxuXG4gICAgX3Jlc3RvcmVSdW46IGZ1bmN0aW9uIChydW5JZCkge1xuICAgICAgICB2YXIgX3RoaXMgPSB0aGlzO1xuICAgICAgICByZXR1cm4gdGhpcy5zdGF0ZUFwaS5yZXBsYXkoeyBydW5JZDogcnVuSWQgfSlcbiAgICAgICAgICAgIC50aGVuKGZ1bmN0aW9uIChyZXNwKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIF90aGlzLl9sb2FkUnVuKHJlc3AucnVuKTtcbiAgICAgICAgICAgIH0pO1xuICAgIH0sXG5cbiAgICBfbG9hZFJ1bjogZnVuY3Rpb24gKGlkLCBvcHRpb25zKSB7XG4gICAgICAgIHJldHVybiB0aGlzLnJ1bi5sb2FkKGlkLCBudWxsLCBvcHRpb25zKTtcbiAgICB9XG5cbn0pO1xuXG5tb2R1bGUuZXhwb3J0cyA9IFN0cmF0ZWd5O1xuIiwibW9kdWxlLmV4cG9ydHMgPSB7XG4gICAgJ25ldy1pZi1pbml0aWFsaXplZCc6IHJlcXVpcmUoJy4vbmV3LWlmLWluaXRpYWxpemVkLXN0cmF0ZWd5JyksXG4gICAgJ25ldy1pZi1wZXJzaXN0ZWQnOiByZXF1aXJlKCcuL25ldy1pZi1wZXJzaXN0ZWQtc3RyYXRlZ3knKSxcbiAgICAnbmV3LWlmLW1pc3NpbmcnOiByZXF1aXJlKCcuL25ldy1pZi1taXNzaW5nLXN0cmF0ZWd5JyksXG4gICAgJ2Fsd2F5cy1uZXcnOiByZXF1aXJlKCcuL2Fsd2F5cy1uZXctc3RyYXRlZ3knKSxcbiAgICAnbXVsdGlwbGF5ZXInOiByZXF1aXJlKCcuL211bHRpcGxheWVyLXN0cmF0ZWd5JyksXG4gICAgJ3BlcnNpc3RlbnQtc2luZ2xlLXBsYXllcic6IHJlcXVpcmUoJy4vcGVyc2lzdGVudC1zaW5nbGUtcGxheWVyLXN0cmF0ZWd5JyksXG4gICAgJ25vbmUnOiByZXF1aXJlKCcuL2lkZW50aXR5LXN0cmF0ZWd5Jylcbn07XG4iLCIndXNlIHN0cmljdCc7XG52YXIgUnVuU2VydmljZSA9IHJlcXVpcmUoJy4uL3NlcnZpY2UvcnVuLWFwaS1zZXJ2aWNlJyk7XG5cbnZhciBkZWZhdWx0cyA9IHtcbiAgICB2YWxpZEZpbHRlcjogeyBzYXZlZDogdHJ1ZSB9XG59O1xuXG5mdW5jdGlvbiBTY2VuYXJpb01hbmFnZXIob3B0aW9ucykge1xuICAgIHRoaXMub3B0aW9ucyA9ICQuZXh0ZW5kKHRydWUsIHt9LCBkZWZhdWx0cywgb3B0aW9ucyk7XG4gICAgdGhpcy5ydW5TZXJ2aWNlID0gdGhpcy5vcHRpb25zLnJ1biB8fCBuZXcgUnVuU2VydmljZSh0aGlzLm9wdGlvbnMpO1xufVxuXG5TY2VuYXJpb01hbmFnZXIucHJvdG90eXBlID0ge1xuICAgIGdldFJ1bnM6IGZ1bmN0aW9uIChmaWx0ZXIpIHtcbiAgICAgICAgdGhpcy5maWx0ZXIgPSAkLmV4dGVuZCh0cnVlLCB7fSwgdGhpcy5vcHRpb25zLnZhbGlkRmlsdGVyLCBmaWx0ZXIpO1xuICAgICAgICByZXR1cm4gdGhpcy5ydW5TZXJ2aWNlLnF1ZXJ5KHRoaXMuZmlsdGVyKTtcbiAgICB9LFxuXG4gICAgbG9hZFZhcmlhYmxlczogZnVuY3Rpb24gKHZhcnMpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMucnVuU2VydmljZS5xdWVyeSh0aGlzLmZpbHRlciwgeyBpbmNsdWRlOiB2YXJzIH0pO1xuICAgIH0sXG5cbiAgICBzYXZlOiBmdW5jdGlvbiAocnVuLCBtZXRhKSB7XG4gICAgICAgIHJldHVybiB0aGlzLl9nZXRTZXJ2aWNlKHJ1bikuc2F2ZSgkLmV4dGVuZCh0cnVlLCB7fSwgeyBzYXZlZDogdHJ1ZSB9LCBtZXRhKSk7XG4gICAgfSxcblxuICAgIGFyY2hpdmU6IGZ1bmN0aW9uIChydW4pIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuX2dldFNlcnZpY2UocnVuKS5zYXZlKHsgc2F2ZWQ6IGZhbHNlIH0pO1xuICAgIH0sXG5cbiAgICBfZ2V0U2VydmljZTogZnVuY3Rpb24gKHJ1bikge1xuICAgICAgICBpZiAodHlwZW9mIHJ1biA9PT0gJ3N0cmluZycpIHtcbiAgICAgICAgICAgIHJldHVybiBuZXcgUnVuU2VydmljZSgkLmV4dGVuZCh0cnVlLCB7fSwgIHRoaXMub3B0aW9ucywgeyBmaWx0ZXI6IHJ1biB9KSk7XG4gICAgICAgIH1cblxuICAgICAgICBpZiAodHlwZW9mIHJ1biA9PT0gJ29iamVjdCcgJiYgcnVuIGluc3RhbmNlb2YgUnVuU2VydmljZSkge1xuICAgICAgICAgICAgcmV0dXJuIHJ1bjtcbiAgICAgICAgfVxuXG4gICAgICAgIHRocm93IG5ldyBFcnJvcignU2F2ZSBtZXRob2QgcmVxdWlyZXMgYSBydW4gc2VydmljZSBvciBhIHJ1bklkJyk7XG4gICAgfSxcblxuICAgIGdldFJ1bjogZnVuY3Rpb24gKHJ1bklkKSB7XG4gICAgICAgIHJldHVybiBuZXcgUnVuU2VydmljZSgkLmV4dGVuZCh0cnVlLCB7fSwgIHRoaXMub3B0aW9ucywgeyBmaWx0ZXI6IHJ1bklkIH0pKTtcbiAgICB9XG59O1xuXG5tb2R1bGUuZXhwb3J0cyA9IFNjZW5hcmlvTWFuYWdlcjtcblxuIiwiJ3VzZSBzdHJpY3QnO1xuXG5cbm1vZHVsZS5leHBvcnRzID0ge1xuICAgIHJlc2V0OiBmdW5jdGlvbiAocGFyYW1zLCBvcHRpb25zLCBtYW5hZ2VyKSB7XG4gICAgICAgIHJldHVybiBtYW5hZ2VyLnJlc2V0KG9wdGlvbnMpO1xuICAgIH1cbn07XG4iLCIvKipcbiogIyMgV29ybGQgTWFuYWdlclxuKlxuKiBBcyBkaXNjdXNzZWQgdW5kZXIgdGhlIFtXb3JsZCBBUEkgQWRhcHRlcl0oLi4vd29ybGQtYXBpLWFkYXB0ZXIvKSwgYSBbcnVuXSguLi8uLi8uLi9nbG9zc2FyeS8jcnVuKSBpcyBhIGNvbGxlY3Rpb24gb2YgZW5kIHVzZXIgaW50ZXJhY3Rpb25zIHdpdGggYSBwcm9qZWN0IGFuZCBpdHMgbW9kZWwuIEZvciBidWlsZGluZyBtdWx0aXBsYXllciBzaW11bGF0aW9ucyB5b3UgdHlwaWNhbGx5IHdhbnQgbXVsdGlwbGUgZW5kIHVzZXJzIHRvIHNoYXJlIHRoZSBzYW1lIHNldCBvZiBpbnRlcmFjdGlvbnMsIGFuZCB3b3JrIHdpdGhpbiBhIGNvbW1vbiBzdGF0ZS4gRXBpY2VudGVyIGFsbG93cyB5b3UgdG8gY3JlYXRlIFwid29ybGRzXCIgdG8gaGFuZGxlIHN1Y2ggY2FzZXMuXG4qXG4qIFRoZSBbV29ybGQgQVBJIEFkYXB0ZXJdKC4uL3dvcmxkLWFwaS1hZGFwdGVyLykgaGFuZGxlcyBjcmVhdGluZyBtdWx0aXBsYXllciB3b3JsZHMsIGFuZCBhZGRpbmcgYW5kIHJlbW92aW5nIGVuZCB1c2VycyBhbmQgcnVucyBmcm9tIGEgd29ybGQuXG4qXG4qIFRoZSBXb3JsZCBNYW5hZ2VyIHByb3ZpZGVzIGFuIGVhc3kgd2F5IHRvIHRyYWNrIGFuZCBhY2Nlc3MgdGhlIGN1cnJlbnQgd29ybGQgYW5kIHJ1biBmb3IgcGFydGljdWxhciBlbmQgdXNlcnMuXG4qXG4qICMjIyBVc2luZyB0aGUgV29ybGQgTWFuYWdlclxuKlxuKiBUbyB1c2UgdGhlIFdvcmxkIE1hbmFnZXIsIGluc3RhbnRpYXRlIGl0LiBUaGVuLCBtYWtlIGNhbGxzIHRvIGFueSBvZiB0aGUgbWV0aG9kcyB5b3UgbmVlZDpcbipcbiogICAgICAgdmFyIHdNZ3IgPSBuZXcgRi5tYW5hZ2VyLldvcmxkTWFuYWdlcigpXG4qICAgICAgIHdNZ3IuZ2V0Q3VycmVudFdvcmxkKCk7XG4qICAgICAgIHdNZ3IuZ2V0Q3VycmVudFJ1bigpO1xuKlxuKiBOb3RlIHRoYXQgdGhlIFdvcmxkIE1hbmFnZXIgZG9lcyAqbm90KiBjcmVhdGUgd29ybGRzIGF1dG9tYXRpY2FsbHkuIChUaGlzIGlzIGRpZmZlcmVudCB0aGFuIHRoZSBbUnVuIE1hbmFnZXJdKC4uL3J1bi1tYW5hZ2VyKS4pIEhvd2V2ZXIsIHlvdSBjYW4gcGFzcyBpbiBzcGVjaWZpYyBvcHRpb25zIHRvIGFueSBydW5zIGNyZWF0ZWQgYnkgdGhlIG1hbmFnZXIsIHVzaW5nIGEgYHJ1bmAgb2JqZWN0LlxuKlxuKiBXaGVuIHlvdSBpbnN0YW50aWF0ZSBhIFdvcmxkIE1hbmFnZXIsIHRoZSB3b3JsZCdzIGFjY291bnQgaWQsIHByb2plY3QgaWQsIGFuZCBncm91cCBhcmUgYXV0b21hdGljYWxseSB0YWtlbiBmcm9tIHRoZSBzZXNzaW9uICh0aGFua3MgdG8gdGhlIFtBdXRoZW50aWNhdGlvbiBTZXJ2aWNlXSguLi9hdXRoLWFwaS1zZXJ2aWNlKSkuIEhvd2V2ZXIsIHlvdSBjYW4gb3ZlcnJpZGUgdGhlc2UgYnkgb3B0aW9uYWxseSBwYXNzaW5nIGluOlxuKlxuKiAgICogYGFjY291bnRgOiBUaGUgKipUZWFtIElEKiogaW4gdGhlIEVwaWNlbnRlciB1c2VyIGludGVyZmFjZSBmb3IgdGhpcyBwcm9qZWN0LlxuKiAgICogYHByb2plY3RgOiBUaGUgKipQcm9qZWN0IElEKiogZm9yIHRoaXMgcHJvamVjdC5cbiogICAqIGBncm91cGA6IFRoZSAqKkdyb3VwIE5hbWUqKiBmb3IgdGhpcyB3b3JsZC5cbiogICAqIGBydW5gOiBPcHRpb25zIHRvIHVzZSB3aGVuIGNyZWF0aW5nIG5ldyBydW5zIHdpdGggdGhlIG1hbmFnZXIsIGUuZy4gYHJ1bjoge2ZpbGVzOiBbJ2RhdGEueGxzJ119YC5cbipcbiogRm9yIGV4YW1wbGU6XG4qXG4qICAgICAgIHZhciB3TWdyID0gbmV3IEYubWFuYWdlci5Xb3JsZE1hbmFnZXIoe1xuKiAgICAgICAgICBhY2NvdW50OiAnYWNtZS1zaW11bGF0aW9ucycsXG4qICAgICAgICAgIHByb2plY3Q6ICdzdXBwbHktY2hhaW4tZ2FtZScsXG4qICAgICAgICAgIGdyb3VwOiAndGVhbTEnXG4qICAgICAgIH0pO1xuKlxuKi9cblxuJ3VzZSBzdHJpY3QnO1xuXG52YXIgV29ybGRBcGkgPSByZXF1aXJlKCcuLi9zZXJ2aWNlL3dvcmxkLWFwaS1hZGFwdGVyJyk7XG52YXIgUnVuTWFuYWdlciA9ICByZXF1aXJlKCcuL3J1bi1tYW5hZ2VyJyk7XG52YXIgQXV0aE1hbmFnZXIgPSByZXF1aXJlKCcuL2F1dGgtbWFuYWdlcicpO1xudmFyIHdvcmxkQXBpO1xuXG4vLyB2YXIgZGVmYXVsdHMgPSB7XG4vLyAgYWNjb3VudDogJycsXG4vLyAgcHJvamVjdDogJycsXG4vLyAgZ3JvdXA6ICcnLFxuLy8gIHRyYW5zcG9ydDoge1xuLy8gIH1cbi8vIH07XG5cblxuZnVuY3Rpb24gYnVpbGRTdHJhdGVneSh3b3JsZElkLCBkdGQpIHtcblxuICAgIHJldHVybiBmdW5jdGlvbiBDdG9yKHJ1blNlcnZpY2UsIG9wdGlvbnMpIHtcbiAgICAgICAgdGhpcy5ydW5TZXJ2aWNlID0gcnVuU2VydmljZTtcbiAgICAgICAgdGhpcy5vcHRpb25zID0gb3B0aW9ucztcblxuICAgICAgICAkLmV4dGVuZCh0aGlzLCB7XG4gICAgICAgICAgICByZXNldDogZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcignbm90IGltcGxlbWVudGQuIE5lZWQgYXBpIGNoYW5nZXMnKTtcbiAgICAgICAgICAgIH0sXG5cbiAgICAgICAgICAgIGdldFJ1bjogZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgICAgIHZhciBfdGhpcyA9IHRoaXM7XG4gICAgICAgICAgICAgICAgLy9nZXQgb3IgY3JlYXRlIVxuICAgICAgICAgICAgICAgIC8vIE1vZGVsIGlzIHJlcXVpcmVkIGluIHRoZSBvcHRpb25zXG4gICAgICAgICAgICAgICAgcmV0dXJuIHdvcmxkQXBpLmdldEN1cnJlbnRSdW5JZCh7IG1vZGVsOiB0aGlzLm9wdGlvbnMucnVuLm1vZGVsLCBmaWx0ZXI6IHdvcmxkSWQgfSlcbiAgICAgICAgICAgICAgICAgICAgLnRoZW4oZnVuY3Rpb24gKHJ1bklkKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICByZXR1cm4gX3RoaXMucnVuU2VydmljZS5sb2FkKHJ1bklkKTtcbiAgICAgICAgICAgICAgICAgICAgfSlcbiAgICAgICAgICAgICAgICAgICAgLnRoZW4oZnVuY3Rpb24gKHJ1bikge1xuICAgICAgICAgICAgICAgICAgICAgICAgZHRkLnJlc29sdmUuY2FsbCh0aGlzLCBydW4sIF90aGlzLnJ1blNlcnZpY2UpO1xuICAgICAgICAgICAgICAgICAgICB9KVxuICAgICAgICAgICAgICAgICAgICAuZmFpbChkdGQucmVqZWN0KTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgICk7XG4gICAgfTtcbn1cblxuXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uIChvcHRpb25zKSB7XG4gICAgdGhpcy5vcHRpb25zID0gb3B0aW9ucyB8fCB7IHJ1bjoge30sIHdvcmxkOiB7fSB9O1xuXG4gICAgJC5leHRlbmQodHJ1ZSwgdGhpcy5vcHRpb25zLCB0aGlzLm9wdGlvbnMucnVuKTtcbiAgICAkLmV4dGVuZCh0cnVlLCB0aGlzLm9wdGlvbnMsIHRoaXMub3B0aW9ucy53b3JsZCk7XG5cbiAgICB3b3JsZEFwaSA9IG5ldyBXb3JsZEFwaSh0aGlzLm9wdGlvbnMpO1xuICAgIHRoaXMuX2F1dGggPSBuZXcgQXV0aE1hbmFnZXIoKTtcbiAgICB2YXIgX3RoaXMgPSB0aGlzO1xuXG4gICAgdmFyIGFwaSA9IHtcblxuICAgICAgICAvKipcbiAgICAgICAgKiBSZXR1cm5zIHRoZSBjdXJyZW50IHdvcmxkIChvYmplY3QpIGFuZCBhbiBpbnN0YW5jZSBvZiB0aGUgW1dvcmxkIEFQSSBBZGFwdGVyXSguLi93b3JsZC1hcGktYWRhcHRlci8pLlxuICAgICAgICAqXG4gICAgICAgICogKipFeGFtcGxlKipcbiAgICAgICAgKlxuICAgICAgICAqICAgICAgIHZhciB3TWdyID0gbmV3IEYubWFuYWdlci5Xb3JsZE1hbmFnZXIoKVxuICAgICAgICAqICAgICAgIHdNZ3IuZ2V0Q3VycmVudFdvcmxkKClcbiAgICAgICAgKiAgICAgICAgICAgLnRoZW4oZnVuY3Rpb24od29ybGQsIHdvcmxkQWRhcHRlcikge1xuICAgICAgICAqICAgICAgICAgICAgICAgY29uc29sZS5sb2cod29ybGQuaWQpO1xuICAgICAgICAqICAgICAgICAgICAgICAgd29ybGRBZGFwdGVyLmdldEN1cnJlbnRSdW5JZCgpO1xuICAgICAgICAqICAgICAgICAgICB9KTtcbiAgICAgICAgKlxuICAgICAgICAqICoqUGFyYW1ldGVycyoqXG4gICAgICAgICogQHBhcmFtIHtzdHJpbmd9IGB1c2VySWRgIChPcHRpb25hbCkgVGhlIGlkIG9mIHRoZSB1c2VyIHdob3NlIHdvcmxkIGlzIGJlaW5nIGFjY2Vzc2VkLiBEZWZhdWx0cyB0byB0aGUgdXNlciBpbiB0aGUgY3VycmVudCBzZXNzaW9uLlxuICAgICAgICAqIEBwYXJhbSB7c3RyaW5nfSBgZ3JvdXBOYW1lYCAoT3B0aW9uYWwpIFRoZSBuYW1lIG9mIHRoZSBncm91cCB3aG9zZSB3b3JsZCBpcyBiZWluZyBhY2Nlc3NlZC4gRGVmYXVsdHMgdG8gdGhlIGdyb3VwIGZvciB0aGUgdXNlciBpbiB0aGUgY3VycmVudCBzZXNzaW9uLlxuICAgICAgICAqL1xuICAgICAgICBnZXRDdXJyZW50V29ybGQ6IGZ1bmN0aW9uICh1c2VySWQsIGdyb3VwTmFtZSkge1xuICAgICAgICAgICAgdmFyIHNlc3Npb24gPSB0aGlzLl9hdXRoLmdldEN1cnJlbnRVc2VyU2Vzc2lvbkluZm8oKTtcbiAgICAgICAgICAgIGlmICghdXNlcklkKSB7XG4gICAgICAgICAgICAgICAgdXNlcklkID0gc2Vzc2lvbi51c2VySWQ7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBpZiAoIWdyb3VwTmFtZSkge1xuICAgICAgICAgICAgICAgIGdyb3VwTmFtZSA9IHNlc3Npb24uZ3JvdXBOYW1lO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgcmV0dXJuIHdvcmxkQXBpLmdldEN1cnJlbnRXb3JsZEZvclVzZXIodXNlcklkLCBncm91cE5hbWUpO1xuICAgICAgICB9LFxuXG4gICAgICAgIC8qKlxuICAgICAgICAqIFJldHVybnMgdGhlIGN1cnJlbnQgcnVuIChvYmplY3QpIGFuZCBhbiBpbnN0YW5jZSBvZiB0aGUgW1J1biBBUEkgU2VydmljZV0oLi4vcnVuLWFwaS1zZXJ2aWNlLykuXG4gICAgICAgICpcbiAgICAgICAgKiAqKkV4YW1wbGUqKlxuICAgICAgICAqXG4gICAgICAgICogICAgICAgdmFyIHdNZ3IgPSBuZXcgRi5tYW5hZ2VyLldvcmxkTWFuYWdlcigpXG4gICAgICAgICogICAgICAgd01nci5nZXRDdXJyZW50UnVuKClcbiAgICAgICAgKiAgICAgICAgICAgLnRoZW4oZnVuY3Rpb24ocnVuLCBydW5TZXJ2aWNlKSB7XG4gICAgICAgICogICAgICAgICAgICAgICBjb25zb2xlLmxvZyhydW4uaWQpO1xuICAgICAgICAqICAgICAgICAgICAgICAgcnVuU2VydmljZS5kbygncnVuTW9kZWwnKTtcbiAgICAgICAgKiAgICAgICAgICAgfSk7XG4gICAgICAgICpcbiAgICAgICAgKiAqKlBhcmFtZXRlcnMqKlxuICAgICAgICAqIEBwYXJhbSB7c3RyaW5nfSBgbW9kZWxgIFRoZSBuYW1lIG9mIHRoZSBtb2RlbCBmaWxlLlxuICAgICAgICAqL1xuICAgICAgICBnZXRDdXJyZW50UnVuOiBmdW5jdGlvbiAobW9kZWwpIHtcbiAgICAgICAgICAgIHZhciBkdGQgPSAkLkRlZmVycmVkKCk7XG4gICAgICAgICAgICB2YXIgc2Vzc2lvbiA9IHRoaXMuX2F1dGguZ2V0Q3VycmVudFVzZXJTZXNzaW9uSW5mbygpO1xuICAgICAgICAgICAgdmFyIGN1clVzZXJJZCA9IHNlc3Npb24udXNlcklkO1xuICAgICAgICAgICAgdmFyIGN1ckdyb3VwTmFtZSA9IHNlc3Npb24uZ3JvdXBOYW1lO1xuXG4gICAgICAgICAgICBmdW5jdGlvbiBnZXRBbmRSZXN0b3JlTGF0ZXN0UnVuKHdvcmxkKSB7XG4gICAgICAgICAgICAgICAgaWYgKCF3b3JsZCkge1xuICAgICAgICAgICAgICAgICAgICByZXR1cm4gZHRkLnJlamVjdCh7IGVycm9yOiAnVGhlIHVzZXIgaXMgbm90IHBhcnQgb2YgYW55IHdvcmxkIScgfSk7XG4gICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgdmFyIGN1cnJlbnRXb3JsZElkID0gd29ybGQuaWQ7XG4gICAgICAgICAgICAgICAgdmFyIHJ1bk9wdHMgPSAkLmV4dGVuZCh0cnVlLCBfdGhpcy5vcHRpb25zLCB7IG1vZGVsOiBtb2RlbCB9KTtcbiAgICAgICAgICAgICAgICB2YXIgc3RyYXRlZ3kgPSBidWlsZFN0cmF0ZWd5KGN1cnJlbnRXb3JsZElkLCBkdGQpO1xuICAgICAgICAgICAgICAgIHZhciBvcHQgPSAkLmV4dGVuZCh0cnVlLCB7fSwge1xuICAgICAgICAgICAgICAgICAgICBzdHJhdGVneTogc3RyYXRlZ3ksXG4gICAgICAgICAgICAgICAgICAgIHJ1bjogcnVuT3B0c1xuICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgICAgIHZhciBybSA9IG5ldyBSdW5NYW5hZ2VyKG9wdCk7XG5cbiAgICAgICAgICAgICAgICByZXR1cm4gcm0uZ2V0UnVuKClcbiAgICAgICAgICAgICAgICAgICAgLnRoZW4oZnVuY3Rpb24gKHJ1bikge1xuICAgICAgICAgICAgICAgICAgICAgICAgZHRkLnJlc29sdmUocnVuLCBybS5ydW5TZXJ2aWNlLCBybSk7XG4gICAgICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICB0aGlzLmdldEN1cnJlbnRXb3JsZChjdXJVc2VySWQsIGN1ckdyb3VwTmFtZSlcbiAgICAgICAgICAgICAgICAudGhlbihnZXRBbmRSZXN0b3JlTGF0ZXN0UnVuKTtcblxuICAgICAgICAgICAgcmV0dXJuIGR0ZC5wcm9taXNlKCk7XG4gICAgICAgIH1cbiAgICB9O1xuXG4gICAgJC5leHRlbmQodGhpcywgYXBpKTtcbn07XG4iLCIvKipcbiAqXG4gKiAjI0F1dGhlbnRpY2F0aW9uIEFQSSBTZXJ2aWNlXG4gKlxuICogVGhlIEF1dGhlbnRpY2F0aW9uIEFQSSBTZXJ2aWNlIHByb3ZpZGVzIG1ldGhvZHMgZm9yIGxvZ2dpbmcgaW4gYW5kIGxvZ2dpbmcgb3V0LiBPbiBsb2dpbiwgdGhpcyBzZXJ2aWNlIGNyZWF0ZXMgYW5kIHJldHVybnMgYSB1c2VyIGFjY2VzcyB0b2tlbi5cbiAqXG4gKiBVc2VyIGFjY2VzcyB0b2tlbnMgYXJlIHJlcXVpcmVkIGZvciBlYWNoIGNhbGwgdG8gRXBpY2VudGVyLiAoU2VlIFtQcm9qZWN0IEFjY2Vzc10oLi4vLi4vLi4vcHJvamVjdF9hY2Nlc3MvKSBmb3IgbW9yZSBpbmZvcm1hdGlvbi4pXG4gKlxuICogSWYgeW91IG5lZWQgYWRkaXRpb25hbCBmdW5jdGlvbmFsaXR5IC0tIHN1Y2ggYXMgdHJhY2tpbmcgc2Vzc2lvbiBpbmZvcm1hdGlvbiwgZWFzaWx5IHJldHJpZXZpbmcgdGhlIHVzZXIgdG9rZW4sIG9yIGdldHRpbmcgdGhlIGdyb3VwcyB0byB3aGljaCBhbiBlbmQgdXNlciBiZWxvbmdzIC0tIGNvbnNpZGVyIHVzaW5nIHRoZSBbQXV0aG9yaXphdGlvbiBNYW5hZ2VyXSguLi9hdXRoLW1hbmFnZXIvKSBpbnN0ZWFkLlxuICpcbiAqICAgICAgdmFyIGF1dGggPSBuZXcgRi5zZXJ2aWNlLkF1dGgoKTtcbiAqICAgICAgYXV0aC5sb2dpbih7IHVzZXJOYW1lOiAnanNtaXRoQGFjbWVzaW11bGF0aW9ucy5jb20nLFxuICogICAgICAgICAgICAgICAgICBwYXNzd29yZDogJ3Bhc3N3MHJkJyB9KTtcbiAqICAgICAgYXV0aC5sb2dvdXQoKTtcbiAqL1xuXG4ndXNlIHN0cmljdCc7XG5cbnZhciBDb25maWdTZXJ2aWNlID0gcmVxdWlyZSgnLi9jb25maWd1cmF0aW9uLXNlcnZpY2UnKTtcbnZhciBUcmFuc3BvcnRGYWN0b3J5ID0gcmVxdWlyZSgnLi4vdHJhbnNwb3J0L2h0dHAtdHJhbnNwb3J0LWZhY3RvcnknKTtcblxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbiAoY29uZmlnKSB7XG4gICAgdmFyIGRlZmF1bHRzID0ge1xuICAgICAgICAvKipcbiAgICAgICAgICogRW1haWwgb3IgdXNlcm5hbWUgdG8gdXNlIGZvciBsb2dnaW5nIGluLiBEZWZhdWx0cyB0byBlbXB0eSBzdHJpbmcuXG4gICAgICAgICAqIEB0eXBlIHtTdHJpbmd9XG4gICAgICAgICAqL1xuICAgICAgICB1c2VyTmFtZTogJycsXG5cbiAgICAgICAgLyoqXG4gICAgICAgICAqIFBhc3N3b3JkIGZvciBzcGVjaWZpZWQgYHVzZXJOYW1lYC4gRGVmYXVsdHMgdG8gZW1wdHkgc3RyaW5nLlxuICAgICAgICAgKiBAdHlwZSB7U3RyaW5nfVxuICAgICAgICAgKi9cbiAgICAgICAgcGFzc3dvcmQ6ICcnLFxuXG4gICAgICAgIC8qKlxuICAgICAgICAgKiBUaGUgYWNjb3VudCBpZCBmb3IgdGhpcyBgdXNlck5hbWVgLiBJbiB0aGUgRXBpY2VudGVyIFVJLCB0aGlzIGlzIHRoZSAqKlRlYW0gSUQqKiAoZm9yIHRlYW0gcHJvamVjdHMpIG9yIHRoZSAqKlVzZXIgSUQqKiAoZm9yIHBlcnNvbmFsIHByb2plY3RzKS4gUmVxdWlyZWQgaWYgdGhlIGB1c2VyTmFtZWAgaXMgZm9yIGFuIFtlbmQgdXNlcl0oLi4vLi4vLi4vZ2xvc3NhcnkvI3VzZXJzKS4gRGVmYXVsdHMgdG8gZW1wdHkgc3RyaW5nLlxuICAgICAgICAgKiBAdHlwZSB7U3RyaW5nfVxuICAgICAgICAgKi9cbiAgICAgICAgYWNjb3VudDogJycsXG5cbiAgICAgICAgLyoqXG4gICAgICAgICAqIE9wdGlvbnMgdG8gcGFzcyBvbiB0byB0aGUgdW5kZXJseWluZyB0cmFuc3BvcnQgbGF5ZXIuIEFsbCBqcXVlcnkuYWpheCBvcHRpb25zIGF0IGh0dHA6Ly9hcGkuanF1ZXJ5LmNvbS9qUXVlcnkuYWpheC8gYXJlIGF2YWlsYWJsZS4gRGVmYXVsdHMgdG8gZW1wdHkgb2JqZWN0LlxuICAgICAgICAgKiBAdHlwZSB7T2JqZWN0fVxuICAgICAgICAgKi9cbiAgICAgICAgdHJhbnNwb3J0OiB7fVxuICAgIH07XG4gICAgdmFyIHNlcnZpY2VPcHRpb25zID0gJC5leHRlbmQoe30sIGRlZmF1bHRzLCBjb25maWcpO1xuICAgIHZhciB1cmxDb25maWcgPSBuZXcgQ29uZmlnU2VydmljZShzZXJ2aWNlT3B0aW9ucykuZ2V0KCdzZXJ2ZXInKTtcblxuICAgIHZhciB0cmFuc3BvcnRPcHRpb25zID0gJC5leHRlbmQodHJ1ZSwge30sIHNlcnZpY2VPcHRpb25zLnRyYW5zcG9ydCwge1xuICAgICAgICB1cmw6IHVybENvbmZpZy5nZXRBUElQYXRoKCdhdXRoZW50aWNhdGlvbicpXG4gICAgfSk7XG4gICAgdmFyIGh0dHAgPSBuZXcgVHJhbnNwb3J0RmFjdG9yeSh0cmFuc3BvcnRPcHRpb25zKTtcblxuICAgIHZhciBwdWJsaWNBUEkgPSB7XG5cbiAgICAgICAgLyoqXG4gICAgICAgICAqIExvZ3MgdXNlciBpbiwgcmV0dXJuaW5nIHRoZSB1c2VyIGFjY2VzcyB0b2tlbi5cbiAgICAgICAgICpcbiAgICAgICAgICogSWYgbm8gYHVzZXJOYW1lYCBvciBgcGFzc3dvcmRgIHdlcmUgcHJvdmlkZWQgaW4gdGhlIGluaXRpYWwgY29uZmlndXJhdGlvbiBvcHRpb25zLCB0aGV5IGFyZSByZXF1aXJlZCBpbiB0aGUgYG9wdGlvbnNgIGhlcmUuIElmIG5vIGBhY2NvdW50YCB3YXMgcHJvdmlkZWQgaW4gdGhlIGluaXRpYWwgY29uZmlndXJhdGlvbiBvcHRpb25zIGFuZCB0aGUgYHVzZXJOYW1lYCBpcyBmb3IgYW4gW2VuZCB1c2VyXSguLi8uLi8uLi9nbG9zc2FyeS8jdXNlcnMpLCB0aGUgYGFjY291bnRgIGlzIHJlcXVpcmVkIGFzIHdlbGwuXG4gICAgICAgICAqXG4gICAgICAgICAqICoqRXhhbXBsZSoqXG4gICAgICAgICAqXG4gICAgICAgICAqICAgICAgYXV0aC5sb2dpbih7XG4gICAgICAgICAqICAgICAgICAgIHVzZXJOYW1lOiAnanNtaXRoJyxcbiAgICAgICAgICogICAgICAgICAgcGFzc3dvcmQ6ICdwYXNzdzByZCcsXG4gICAgICAgICAqICAgICAgICAgIGFjY291bnQ6ICdhY21lLXNpbXVsYXRpb25zJyB9KVxuICAgICAgICAgKiAgICAgIC50aGVuKGZ1bmN0aW9uICh0b2tlbikge1xuICAgICAgICAgKiAgICAgICAgICBjb25zb2xlLmxvZyhcInVzZXIgYWNjZXNzIHRva2VuIGlzOiBcIiwgdG9rZW4uYWNjZXNzX3Rva2VuKTtcbiAgICAgICAgICogICAgICB9KTtcbiAgICAgICAgICpcbiAgICAgICAgICogKipQYXJhbWV0ZXJzKipcbiAgICAgICAgICogQHBhcmFtIHtPYmplY3R9IGBvcHRpb25zYCAoT3B0aW9uYWwpIE92ZXJyaWRlcyBmb3IgY29uZmlndXJhdGlvbiBvcHRpb25zLlxuICAgICAgICAgKi9cbiAgICAgICAgbG9naW46IGZ1bmN0aW9uIChvcHRpb25zKSB7XG4gICAgICAgICAgICB2YXIgaHR0cE9wdGlvbnMgPSAkLmV4dGVuZCh0cnVlLCB7IHN1Y2Nlc3M6ICQubm9vcCB9LCBzZXJ2aWNlT3B0aW9ucywgb3B0aW9ucyk7XG4gICAgICAgICAgICBpZiAoIWh0dHBPcHRpb25zLnVzZXJOYW1lIHx8ICFodHRwT3B0aW9ucy5wYXNzd29yZCkge1xuICAgICAgICAgICAgICAgIHZhciByZXNwID0geyBzdGF0dXM6IDQwMSwgc3RhdHVzTWVzc2FnZTogJ05vIHVzZXJuYW1lIG9yIHBhc3N3b3JkIHNwZWNpZmllZC4nIH07XG4gICAgICAgICAgICAgICAgaWYgKG9wdGlvbnMuZXJyb3IpIHtcbiAgICAgICAgICAgICAgICAgICAgb3B0aW9ucy5lcnJvci5jYWxsKHRoaXMsIHJlc3ApO1xuICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgIHJldHVybiAkLkRlZmVycmVkKCkucmVqZWN0KHJlc3ApLnByb21pc2UoKTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgdmFyIHBvc3RQYXJhbXMgPSB7XG4gICAgICAgICAgICAgICAgdXNlck5hbWU6IGh0dHBPcHRpb25zLnVzZXJOYW1lLFxuICAgICAgICAgICAgICAgIHBhc3N3b3JkOiBodHRwT3B0aW9ucy5wYXNzd29yZCxcbiAgICAgICAgICAgIH07XG4gICAgICAgICAgICBpZiAoaHR0cE9wdGlvbnMuYWNjb3VudCkge1xuICAgICAgICAgICAgICAgIC8vcGFzcyBpbiBudWxsIGZvciBhY2NvdW50IHVuZGVyIG9wdGlvbnMgaWYgeW91IGRvbid0IHdhbnQgaXQgdG8gYmUgc2VudFxuICAgICAgICAgICAgICAgIHBvc3RQYXJhbXMuYWNjb3VudCA9IGh0dHBPcHRpb25zLmFjY291bnQ7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIHJldHVybiBodHRwLnBvc3QocG9zdFBhcmFtcywgaHR0cE9wdGlvbnMpO1xuICAgICAgICB9LFxuXG4gICAgICAgIC8qKlxuICAgICAgICAgKiBMb2dzIHVzZXIgb3V0IGZyb20gc3BlY2lmaWVkIGFjY291bnRzLlxuICAgICAgICAgKlxuICAgICAgICAgKiAqKkV4YW1wbGUqKlxuICAgICAgICAgKlxuICAgICAgICAgKiAgICAgIGF1dGgubG9nb3V0KCk7XG4gICAgICAgICAqXG4gICAgICAgICAqICoqUGFyYW1ldGVycyoqXG4gICAgICAgICAqIEBwYXJhbSB7T2JqZWN0fSBgb3B0aW9uc2AgKE9wdGlvbmFsKSBPdmVycmlkZXMgZm9yIGNvbmZpZ3VyYXRpb24gb3B0aW9ucy5cbiAgICAgICAgICovXG4gICAgICAgIGxvZ291dDogZnVuY3Rpb24gKG9wdGlvbnMpIHtcbiAgICAgICAgICAgIHZhciBodHRwT3B0aW9ucyA9ICQuZXh0ZW5kKHRydWUsIHNlcnZpY2VPcHRpb25zLCB0cmFuc3BvcnRPcHRpb25zLCBvcHRpb25zKTtcbiAgICAgICAgICAgIGlmICghaHR0cE9wdGlvbnMudG9rZW4pIHtcbiAgICAgICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ05vIHRva2VuIHdhcyBzcGVjaWZpZWQuJyk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICB2YXIgc2xhc2ggPSBodHRwT3B0aW9ucy51cmwuc2xpY2UoLTEpID09PSAnLycgPyAnJyA6ICcvJztcbiAgICAgICAgICAgIGh0dHBPcHRpb25zLnVybCA9IGh0dHBPcHRpb25zLnVybCArIHNsYXNoICsgaHR0cE9wdGlvbnMudG9rZW47XG4gICAgICAgICAgICB2YXIgZGVsZXRlUGFyYW1zID0ge307XG5cbiAgICAgICAgICAgIHJldHVybiBodHRwLmRlbGV0ZShkZWxldGVQYXJhbXMsIGh0dHBPcHRpb25zKTtcbiAgICAgICAgfVxuICAgIH07XG5cbiAgICAkLmV4dGVuZCh0aGlzLCBwdWJsaWNBUEkpO1xufTtcbiIsIid1c2Ugc3RyaWN0JztcblxuLyoqXG4gKiAjIyBDaGFubmVsIFNlcnZpY2VcbiAqXG4gKiBUaGUgRXBpY2VudGVyIHBsYXRmb3JtIHByb3ZpZGVzIGEgcHVzaCBjaGFubmVsLCB3aGljaCBhbGxvd3MgeW91IHRvIHB1Ymxpc2ggYW5kIHN1YnNjcmliZSB0byBtZXNzYWdlcyB3aXRoaW4gYSBbcHJvamVjdF0oLi4vLi4vLi4vZ2xvc3NhcnkvI3Byb2plY3RzKSwgW2dyb3VwXSguLi8uLi8uLi9nbG9zc2FyeS8jZ3JvdXBzKSwgb3IgW211bHRpcGxheWVyIHdvcmxkXSguLi8uLi8uLi9nbG9zc2FyeS8jd29ybGQpLiBUaGVyZSBhcmUgdHdvIG1haW4gdXNlIGNhc2VzIGZvciB0aGUgY2hhbm5lbDogZXZlbnQgbm90aWZpY2F0aW9ucyBhbmQgY2hhdCBtZXNzYWdlcy5cbiAqXG4gKiBUaGUgQ2hhbm5lbCBTZXJ2aWNlIGlzIGEgYnVpbGRpbmcgYmxvY2sgZm9yIHRoaXMgZnVuY3Rpb25hbGl0eS4gSXQgY3JlYXRlcyBhIHB1Ymxpc2gtc3Vic2NyaWJlIG9iamVjdCwgYWxsb3dpbmcgeW91IHRvIHB1Ymxpc2ggbWVzc2FnZXMsIHN1YnNjcmliZSB0byBtZXNzYWdlcywgb3IgdW5zdWJzY3JpYmUgZnJvbSBtZXNzYWdlcyBmb3IgYSBnaXZlbiAndG9waWMnIG9uIGEgYCQuY29tZXRkYCB0cmFuc3BvcnQgaW5zdGFuY2UuXG4gKlxuICogVHlwaWNhbGx5LCB5b3UgdXNlIHRoZSBbRXBpY2VudGVyIENoYW5uZWwgTWFuYWdlcl0oLi4vZXBpY2VudGVyLWNoYW5uZWwtbWFuYWdlci8pIHRvIGNyZWF0ZSBvciByZXRyaWV2ZSBjaGFubmVscywgdGhlbiB1c2UgdGhlIENoYW5uZWwgU2VydmljZSBgc3Vic2NyaWJlKClgIGFuZCBgcHVibGlzaCgpYCBtZXRob2RzIHRvIGxpc3RlbiB0byBvciB1cGRhdGUgZGF0YS4gKEZvciBhZGRpdGlvbmFsIGJhY2tncm91bmQgb24gRXBpY2VudGVyJ3MgcHVzaCBjaGFubmVsLCBzZWUgdGhlIGludHJvZHVjdG9yeSBub3RlcyBvbiB0aGUgW1B1c2ggQ2hhbm5lbCBBUEldKC4uLy4uLy4uL3Jlc3RfYXBpcy9tdWx0aXBsYXllci9jaGFubmVsLykgcGFnZS4pXG4gKlxuICogWW91J2xsIG5lZWQgdG8gaW5jbHVkZSB0aGUgYGVwaWNlbnRlci1tdWx0aXBsYXllci1kZXBlbmRlbmNpZXMuanNgIGxpYnJhcnkgaW4gYWRkaXRpb24gdG8gdGhlIGBlcGljZW50ZXIuanNgIGxpYnJhcnkgaW4geW91ciBwcm9qZWN0IHRvIHVzZSB0aGUgQ2hhbm5lbCBTZXJ2aWNlLiAoU2VlIFtJbmNsdWRpbmcgRXBpY2VudGVyLmpzXSguLi8uLi8jaW5jbHVkZSkuKVxuICpcbiAqIFRvIHVzZSB0aGUgQ2hhbm5lbCBTZXJ2aWNlLCBpbnN0YW50aWF0ZSBpdCwgdGhlbiBtYWtlIGNhbGxzIHRvIGFueSBvZiB0aGUgbWV0aG9kcyB5b3UgbmVlZC5cbiAqXG4gKiAgICAgICAgdmFyIGNzID0gbmV3IEYuc2VydmljZS5DaGFubmVsKCk7XG4gKiAgICAgICAgY3MucHVibGlzaCgncnVuL3ZhcmlhYmxlcycsIHtwcmljZTogNTB9KTtcbiAqXG4gKiBUaGUgcGFyYW1ldGVycyBmb3IgaW5zdGFudGlhdGluZyBhIENoYW5uZWwgU2VydmljZSBpbmNsdWRlOlxuICpcbiAqICogYG9wdGlvbnNgIFRoZSBvcHRpb25zIG9iamVjdCB0byBjb25maWd1cmUgdGhlIENoYW5uZWwgU2VydmljZS5cbiAqICogYG9wdGlvbnMuYmFzZWAgVGhlIGJhc2UgdG9waWMuIFRoaXMgaXMgYWRkZWQgYXMgYSBwcmVmaXggdG8gYWxsIGZ1cnRoZXIgdG9waWNzIHlvdSBwdWJsaXNoIG9yIHN1YnNjcmliZSB0byB3aGlsZSB3b3JraW5nIHdpdGggdGhpcyBDaGFubmVsIFNlcnZpY2UuXG4gKiAqIGBvcHRpb25zLnRvcGljUmVzb2x2ZXJgIEEgZnVuY3Rpb24gdGhhdCBwcm9jZXNzZXMgYWxsICd0b3BpY3MnIHBhc3NlZCBpbnRvIHRoZSBgcHVibGlzaGAgYW5kIGBzdWJzY3JpYmVgIG1ldGhvZHMuIFRoaXMgaXMgdXNlZnVsIGlmIHlvdSB3YW50IHRvIGltcGxlbWVudCB5b3VyIG93biBzZXJpYWxpemUgZnVuY3Rpb25zIGZvciBjb252ZXJ0aW5nIGN1c3RvbSBvYmplY3RzIHRvIHRvcGljIG5hbWVzLiBSZXR1cm5zIGEgU3RyaW5nLiBCeSBkZWZhdWx0LCBpdCBqdXN0IGVjaG9lcyB0aGUgdG9waWMuXG4gKiAqIGBvcHRpb25zLnRyYW5zcG9ydGAgVGhlIGluc3RhbmNlIG9mIGAkLmNvbWV0ZGAgdG8gaG9vayBvbnRvLiBTZWUgaHR0cDovL2RvY3MuY29tZXRkLm9yZy9yZWZlcmVuY2UvamF2YXNjcmlwdC5odG1sIGZvciBhZGRpdGlvbmFsIGJhY2tncm91bmQgb24gY29tZXRkLlxuICovXG52YXIgQ2hhbm5lbCA9IGZ1bmN0aW9uIChvcHRpb25zKSB7XG4gICAgdmFyIGRlZmF1bHRzID0ge1xuXG4gICAgICAgIC8qKlxuICAgICAgICAgKiBUaGUgYmFzZSB0b3BpYy4gVGhpcyBpcyBhZGRlZCBhcyBhIHByZWZpeCB0byBhbGwgZnVydGhlciB0b3BpY3MgeW91IHB1Ymxpc2ggb3Igc3Vic2NyaWJlIHRvIHdoaWxlIHdvcmtpbmcgd2l0aCB0aGlzIENoYW5uZWwgU2VydmljZS5cbiAgICAgICAgICovXG4gICAgICAgIGJhc2U6ICcnLFxuXG4gICAgICAgIC8qKlxuICAgICAgICAgKiBBIGZ1bmN0aW9uIHRoYXQgcHJvY2Vzc2VzIGFsbCAndG9waWNzJyBwYXNzZWQgaW50byB0aGUgYHB1Ymxpc2hgIGFuZCBgc3Vic2NyaWJlYCBtZXRob2RzLiBUaGlzIGlzIHVzZWZ1bCBpZiB5b3Ugd2FudCB0byBpbXBsZW1lbnQgeW91ciBvd24gc2VyaWFsaXplIGZ1bmN0aW9ucyBmb3IgY29udmVydGluZyBjdXN0b20gb2JqZWN0cyB0byB0b3BpYyBuYW1lcy4gQnkgZGVmYXVsdCwgaXQganVzdCBlY2hvZXMgdGhlIHRvcGljLlxuICAgICAgICAgKlxuICAgICAgICAgKiAqKlBhcmFtZXRlcnMqKlxuICAgICAgICAgKlxuICAgICAgICAgKiAqIGB0b3BpY2AgVG9waWMgdG8gcGFyc2UuXG4gICAgICAgICAqXG4gICAgICAgICAqICoqUmV0dXJuIFZhbHVlKipcbiAgICAgICAgICpcbiAgICAgICAgICogKiAqU3RyaW5nKjogVGhpcyBmdW5jdGlvbiBzaG91bGQgcmV0dXJuIGEgc3RyaW5nIHRvcGljLlxuICAgICAgICAgKi9cbiAgICAgICAgdG9waWNSZXNvbHZlcjogZnVuY3Rpb24gKHRvcGljKSB7XG4gICAgICAgICAgICByZXR1cm4gdG9waWM7XG4gICAgICAgIH0sXG5cbiAgICAgICAgLyoqXG4gICAgICAgICAqIFRoZSBpbnN0YW5jZSBvZiBgJC5jb21ldGRgIHRvIGhvb2sgb250by5cbiAgICAgICAgICovXG4gICAgICAgIHRyYW5zcG9ydDogbnVsbFxuICAgIH07XG4gICAgdGhpcy5jaGFubmVsT3B0aW9ucyA9ICQuZXh0ZW5kKHRydWUsIHt9LCBkZWZhdWx0cywgb3B0aW9ucyk7XG59O1xuXG52YXIgbWFrZU5hbWUgPSBmdW5jdGlvbiAoY2hhbm5lbE5hbWUsIHRvcGljKSB7XG4gICAgLy9SZXBsYWNlIHRyYWlsaW5nL2RvdWJsZSBzbGFzaGVzXG4gICAgdmFyIG5ld05hbWUgPSAoY2hhbm5lbE5hbWUgPyAoY2hhbm5lbE5hbWUgKyAnLycgKyB0b3BpYykgOiB0b3BpYykucmVwbGFjZSgvXFwvXFwvL2csICcvJykucmVwbGFjZSgvXFwvJC8sJycpO1xuICAgIHJldHVybiBuZXdOYW1lO1xufTtcblxuXG5DaGFubmVsLnByb3RvdHlwZSA9ICQuZXh0ZW5kKENoYW5uZWwucHJvdG90eXBlLCB7XG5cbiAgICAvLyBmdXR1cmUgZnVuY3Rpb25hbGl0eTpcbiAgICAvLyAgICAgIC8vIFNldCB0aGUgY29udGV4dCBmb3IgdGhlIGNhbGxiYWNrXG4gICAgLy8gICAgICBjcy5zdWJzY3JpYmUoJ3J1bicsIGZ1bmN0aW9uICgpIHsgdGhpcy5pbm5lckhUTUwgPSAnVHJpZ2dlcmVkJ30sIGRvY3VtZW50LmJvZHkpO1xuICAgICAvL1xuICAgICAvLyAgICAgIC8vIENvbnRyb2wgdGhlIG9yZGVyIG9mIG9wZXJhdGlvbnMgYnkgc2V0dGluZyB0aGUgYHByaW9yaXR5YFxuICAgICAvLyAgICAgIGNzLnN1YnNjcmliZSgncnVuJywgY2IsIHRoaXMsIHtwcmlvcml0eTogOX0pO1xuICAgICAvL1xuICAgICAvLyAgICAgIC8vIE9ubHkgZXhlY3V0ZSB0aGUgY2FsbGJhY2ssIGBjYmAsIGlmIHRoZSB2YWx1ZSBvZiB0aGUgYHByaWNlYCB2YXJpYWJsZSBpcyA1MFxuICAgICAvLyAgICAgIGNzLnN1YnNjcmliZSgncnVuL3ZhcmlhYmxlcy9wcmljZScsIGNiLCB0aGlzLCB7cHJpb3JpdHk6IDMwLCB2YWx1ZTogNTB9KTtcbiAgICAgLy9cbiAgICAgLy8gICAgICAvLyBPbmx5IGV4ZWN1dGUgdGhlIGNhbGxiYWNrLCBgY2JgLCBpZiB0aGUgdmFsdWUgb2YgdGhlIGBwcmljZWAgdmFyaWFibGUgaXMgZ3JlYXRlciB0aGFuIDUwXG4gICAgIC8vICAgICAgc3Vic2NyaWJlKCdydW4vdmFyaWFibGVzL3ByaWNlJywgY2IsIHRoaXMsIHtwcmlvcml0eTogMzAsIHZhbHVlOiAnPjUwJ30pO1xuICAgICAvL1xuICAgICAvLyAgICAgIC8vIE9ubHkgZXhlY3V0ZSB0aGUgY2FsbGJhY2ssIGBjYmAsIGlmIHRoZSB2YWx1ZSBvZiB0aGUgYHByaWNlYCB2YXJpYWJsZSBpcyBldmVuXG4gICAgIC8vICAgICAgc3Vic2NyaWJlKCdydW4vdmFyaWFibGVzL3ByaWNlJywgY2IsIHRoaXMsIHtwcmlvcml0eTogMzAsIHZhbHVlOiBmdW5jdGlvbiAodmFsKSB7cmV0dXJuIHZhbCAlIDIgPT09IDB9fSk7XG5cblxuICAgIC8qKlxuICAgICAqIFN1YnNjcmliZSB0byBjaGFuZ2VzIG9uIGEgdG9waWMuXG4gICAgICpcbiAgICAgKiAgKipFeGFtcGxlcyoqXG4gICAgICpcbiAgICAgKiAgICAgIC8vIFN1YnNjcmliZSB0byBjaGFuZ2VzIG9uIGEgdG9wLWxldmVsICdydW4nIHRvcGljXG4gICAgICogICAgICBjcy5zdWJzY3JpYmUoJ3J1bicsIGNiKTtcbiAgICAgKlxuICAgICAqICAgICAgLy8gU3Vic2NyaWJlIHRvIGNoYW5nZXMgb24gY2hpbGRyZW4gb2YgdGhlICdydW4nIHRvcGljLiBOb3RlIHRoaXMgd2lsbCBhbHNvIGJlIHRyaWdnZXJlZCBmb3IgY2hhbmdlcyB0byBydW4ueC55LnouXG4gICAgICogICAgICBjcy5zdWJzY3JpYmUoJ3J1bi8qJyk7XG4gICAgICpcbiAgICAgKiAgICAgIC8vIFN1YnNjcmliZSB0byBjaGFuZ2VzIG9uIGJvdGggdGhlIHRvcC1sZXZlbCAncnVuJyB0b3BpYyBhbmQgaXRzIGNoaWxkcmVuXG4gICAgICogICAgICBjcy5zdWJzY3JpYmUoWydydW4nLCAncnVuLyonXSk7XG4gICAgICpcbiAgICAgKiAgICAgIC8vIFN1YnNjcmliZSB0byBjaGFuZ2VzIG9uIGEgcGFydGljdWxhciB2YXJpYWJsZVxuICAgICAqICAgICAgc3Vic2NyaWJlKCdydW4vdmFyaWFibGVzL3ByaWNlJywgY2IpO1xuICAgICAqXG4gICAgICpcbiAgICAgKiAqKlJldHVybiBWYWx1ZSoqXG4gICAgICpcbiAgICAgKiAqICpTdHJpbmcqIFJldHVybnMgYSB0b2tlbiB5b3UgY2FuIGxhdGVyIHVzZSB0byB1bnN1YnNjcmliZS5cbiAgICAgKlxuICAgICAqICoqUGFyYW1ldGVycyoqXG4gICAgICogQHBhcmFtICB7U3RyaW5nfEFycmF5fSAgIGB0b3BpY2AgICAgTGlzdCBvZiB0b3BpY3MgdG8gbGlzdGVuIGZvciBjaGFuZ2VzIG9uLlxuICAgICAqIEBwYXJhbSAge0Z1bmN0aW9ufSBgY2FsbGJhY2tgIENhbGxiYWNrIGZ1bmN0aW9uIHRvIGV4ZWN1dGUuIENhbGxiYWNrIGlzIGNhbGxlZCB3aXRoIHNpZ25hdHVyZSBgKGV2dCwgcGF5bG9hZCwgbWV0YWRhdGEpYC5cbiAgICAgKiBAcGFyYW0gIHtPYmplY3R9ICAgYGNvbnRleHRgICBDb250ZXh0IGluIHdoaWNoIHRoZSBgY2FsbGJhY2tgIGlzIGV4ZWN1dGVkLlxuICAgICAqIEBwYXJhbSAge09iamVjdH0gICBgb3B0aW9uc2AgIChPcHRpb25hbCkgT3ZlcnJpZGVzIGZvciBjb25maWd1cmF0aW9uIG9wdGlvbnMuXG4gICAgICogQHBhcmFtICB7TnVtYmVyfSAgIGBvcHRpb25zLnByaW9yaXR5YCAgVXNlZCB0byBjb250cm9sIG9yZGVyIG9mIG9wZXJhdGlvbnMuIERlZmF1bHRzIHRvIDAuIENhbiBiZSBhbnkgK3ZlIG9yIC12ZSBudW1iZXIuXG4gICAgICogQHBhcmFtICB7U3RyaW5nfE51bWJlcnxGdW5jdGlvbn0gICBgb3B0aW9ucy52YWx1ZWAgVGhlIGBjYWxsYmFja2AgaXMgb25seSB0cmlnZ2VyZWQgaWYgdGhpcyBjb25kaXRpb24gbWF0Y2hlcy4gU2VlIGV4YW1wbGVzIGZvciBkZXRhaWxzLlxuICAgICAqXG4gICAgICovXG4gICAgc3Vic2NyaWJlOiBmdW5jdGlvbiAodG9waWMsIGNhbGxiYWNrLCBjb250ZXh0LCBvcHRpb25zKSB7XG5cbiAgICAgICAgdmFyIHRvcGljcyA9IFtdLmNvbmNhdCh0b3BpYyk7XG4gICAgICAgIHZhciBtZSA9IHRoaXM7XG4gICAgICAgIHZhciBzdWJzY3JpcHRpb25JZHMgPSBbXTtcbiAgICAgICAgdmFyIG9wdHMgPSBtZS5jaGFubmVsT3B0aW9ucztcblxuICAgICAgICBvcHRzLnRyYW5zcG9ydC5iYXRjaChmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICAkLmVhY2godG9waWNzLCBmdW5jdGlvbiAoaW5kZXgsIHRvcGljKSB7XG4gICAgICAgICAgICAgICAgdG9waWMgPSBtYWtlTmFtZShvcHRzLmJhc2UsIG9wdHMudG9waWNSZXNvbHZlcih0b3BpYykpO1xuICAgICAgICAgICAgICAgIHN1YnNjcmlwdGlvbklkcy5wdXNoKG9wdHMudHJhbnNwb3J0LnN1YnNjcmliZSh0b3BpYywgY2FsbGJhY2spKTtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9KTtcbiAgICAgICAgcmV0dXJuIChzdWJzY3JpcHRpb25JZHNbMV0gPyBzdWJzY3JpcHRpb25JZHMgOiBzdWJzY3JpcHRpb25JZHNbMF0pO1xuICAgIH0sXG5cbiAgICAvKipcbiAgICAgKiBQdWJsaXNoIGRhdGEgdG8gYSB0b3BpYy5cbiAgICAgKlxuICAgICAqICoqRXhhbXBsZXMqKlxuICAgICAqXG4gICAgICogICAgICAvLyBTZW5kIGRhdGEgdG8gYWxsIHN1YnNjcmliZXJzIG9mIHRoZSAncnVuJyB0b3BpY1xuICAgICAqICAgICAgY3MucHVibGlzaCgncnVuJywge2NvbXBsZXRlZDogZmFsc2V9KTtcbiAgICAgKlxuICAgICAqICAgICAgLy8gU2VuZCBkYXRhIHRvIGFsbCBzdWJzY3JpYmVycyBvZiB0aGUgJ3J1bi92YXJpYWJsZXMnIHRvcGljXG4gICAgICogICAgICBjcy5wdWJsaXNoKCdydW4vdmFyaWFibGVzJywge3ByaWNlOiA1MH0pO1xuICAgICAqXG4gICAgICogKipQYXJhbWV0ZXJzKipcbiAgICAgKlxuICAgICAqIEBwYXJhbSAge1N0cmluZ30gYHRvcGljYCBUb3BpYyB0byBwdWJsaXNoIHRvLlxuICAgICAqIEBwYXJhbSAgeyp9IGBwYXlsb2FkYCAgRGF0YSB0byBwdWJsaXNoIHRvIHRvcGljLlxuICAgICAqXG4gICAgICovXG4gICAgcHVibGlzaDogZnVuY3Rpb24gKHRvcGljLCBkYXRhKSB7XG4gICAgICAgIHZhciB0b3BpY3MgPSBbXS5jb25jYXQodG9waWMpO1xuICAgICAgICB2YXIgbWUgPSB0aGlzO1xuICAgICAgICB2YXIgcmV0dXJuT2JqcyA9IFtdO1xuICAgICAgICB2YXIgb3B0cyA9IG1lLmNoYW5uZWxPcHRpb25zO1xuXG5cbiAgICAgICAgb3B0cy50cmFuc3BvcnQuYmF0Y2goZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgJC5lYWNoKHRvcGljcywgZnVuY3Rpb24gKGluZGV4LCB0b3BpYykge1xuICAgICAgICAgICAgICAgIHRvcGljID0gbWFrZU5hbWUob3B0cy5iYXNlLCBvcHRzLnRvcGljUmVzb2x2ZXIodG9waWMpKTtcbiAgICAgICAgICAgICAgICBpZiAodG9waWMuY2hhckF0KHRvcGljLmxlbmd0aCAtIDEpID09PSAnKicpIHtcbiAgICAgICAgICAgICAgICAgICAgdG9waWMgPSB0b3BpYy5yZXBsYWNlKC9cXCorJC8sICcnKTtcbiAgICAgICAgICAgICAgICAgICAgY29uc29sZS53YXJuKCdZb3UgY2FuIGNhbm5vdCBwdWJsaXNoIHRvIGNoYW5uZWxzIHdpdGggd2lsZGNhcmRzLiBQdWJsaXNoaW5nIHRvICcsIHRvcGljLCAnaW5zdGVhZCcpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICByZXR1cm5PYmpzLnB1c2gob3B0cy50cmFuc3BvcnQucHVibGlzaCh0b3BpYywgZGF0YSkpO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgIH0pO1xuICAgICAgICByZXR1cm4gKHJldHVybk9ianNbMV0gPyByZXR1cm5PYmpzIDogcmV0dXJuT2Jqc1swXSk7XG4gICAgfSxcblxuICAgIC8qKlxuICAgICAqIFVuc3Vic2NyaWJlIGZyb20gY2hhbmdlcyB0byBhIHRvcGljLlxuICAgICAqXG4gICAgICogKipFeGFtcGxlKipcbiAgICAgKlxuICAgICAqICAgICAgY3MudW5zdWJzY3JpYmUoJ3NhbXBsZVRva2VuJyk7XG4gICAgICpcbiAgICAgKiAqKlBhcmFtZXRlcnMqKlxuICAgICAqIEBwYXJhbSAge1N0cmluZ30gYHRva2VuYCBUaGUgdG9rZW4gZm9yIHRvcGljIGlzIHJldHVybmVkIHdoZW4geW91IGluaXRpYWxseSBzdWJzY3JpYmUuIFBhc3MgaXQgaGVyZSB0byB1bnN1YnNjcmliZSBmcm9tIHRoYXQgdG9waWMuXG4gICAgICovXG4gICAgdW5zdWJzY3JpYmU6IGZ1bmN0aW9uICh0b2tlbikge1xuICAgICAgICB0aGlzLmNoYW5uZWxPcHRpb25zLnRyYW5zcG9ydC51bnN1YnNjcmliZSh0b2tlbik7XG4gICAgICAgIHJldHVybiB0b2tlbjtcbiAgICB9XG5cbn0pO1xuXG5tb2R1bGUuZXhwb3J0cyA9IENoYW5uZWw7XG4iLCIvKipcbiAqIEBjbGFzcyBDb25maWd1cmF0aW9uU2VydmljZVxuICpcbiAqIEFsbCBzZXJ2aWNlcyB0YWtlIGluIGEgY29uZmlndXJhdGlvbiBzZXR0aW5ncyBvYmplY3QgdG8gY29uZmlndXJlIHRoZW1zZWx2ZXMuIEEgSlMgaGFzaCB7fSBpcyBhIHZhbGlkIGNvbmZpZ3VyYXRpb24gb2JqZWN0LCBidXQgb3B0aW9uYWxseSB5b3UgY2FuIHVzZSB0aGUgY29uZmlndXJhdGlvbiBzZXJ2aWNlIHRvIHRvZ2dsZSBjb25maWdzIGJhc2VkIG9uIHRoZSBlbnZpcm9ubWVudFxuICpcbiAqIEBleGFtcGxlXG4gKiAgICAgdmFyIGNzID0gcmVxdWlyZSgnY29uZmlndXJhdGlvbi1zZXJ2aWNlJykoe1xuICogICAgICAgICAgZGV2OiB7IC8vZW52aXJvbm1lbnRcbiAgICAgICAgICAgICAgICBwb3J0OiAzMDAwLFxuICAgICAgICAgICAgICAgIGhvc3Q6ICdsb2NhbGhvc3QnLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIHByb2Q6IHtcbiAgICAgICAgICAgICAgICBwb3J0OiA4MDgwLFxuICAgICAgICAgICAgICAgIGhvc3Q6ICdhcGkuZm9yaW8uY29tJyxcbiAgICAgICAgICAgICAgICBsb2dMZXZlbDogJ25vbmUnXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgbG9nTGV2ZWw6ICdERUJVRycgLy9nbG9iYWxcbiAqICAgICB9KTtcbiAqXG4gKiAgICAgIGNzLmdldCgnbG9nTGV2ZWwnKTsgLy9yZXR1cm5zICdERUJVRydcbiAqXG4gKiAgICAgIGNzLnNldEVudignZGV2Jyk7XG4gKiAgICAgIGNzLmdldCgnbG9nTGV2ZWwnKTsgLy9yZXR1cm5zICdERUJVRydcbiAqXG4gKiAgICAgIGNzLnNldEVudigncHJvZCcpO1xuICogICAgICBjcy5nZXQoJ2xvZ0xldmVsJyk7IC8vcmV0dXJucyAnbm9uZSdcbiAqXG4gKi9cblxuJ3VzZSBzdHJpY3QnO1xudmFyIHVybFNlcnZpY2UgPSByZXF1aXJlKCcuL3VybC1jb25maWctc2VydmljZScpO1xuXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uIChjb25maWcpIHtcbiAgICAvL1RPRE86IEVudmlyb25tZW50c1xuICAgIHZhciBkZWZhdWx0cyA9IHtcbiAgICAgICAgbG9nTGV2ZWw6ICdOT05FJ1xuICAgIH07XG4gICAgdmFyIHNlcnZpY2VPcHRpb25zID0gJC5leHRlbmQoe30sIGRlZmF1bHRzLCBjb25maWcpO1xuICAgIHNlcnZpY2VPcHRpb25zLnNlcnZlciA9IHVybFNlcnZpY2Uoc2VydmljZU9wdGlvbnMuc2VydmVyKTtcblxuICAgIHJldHVybiB7XG5cbiAgICAgICAgZGF0YTogc2VydmljZU9wdGlvbnMsXG5cbiAgICAgICAgLyoqXG4gICAgICAgICAqIFNldCB0aGUgZW52aXJvbm1lbnQga2V5IHRvIGdldCBjb25maWd1cmF0aW9uIG9wdGlvbnMgZnJvbVxuICAgICAgICAgKiBAcGFyYW0geyBzdHJpbmd9IGVudlxuICAgICAgICAgKi9cbiAgICAgICAgc2V0RW52OiBmdW5jdGlvbiAoZW52KSB7XG5cbiAgICAgICAgfSxcblxuICAgICAgICAvKipcbiAgICAgICAgICogR2V0IGNvbmZpZ3VyYXRpb24uXG4gICAgICAgICAqIEBwYXJhbSAgeyBzdHJpbmd9IHByb3BlcnR5IG9wdGlvbmFsXG4gICAgICAgICAqIEByZXR1cm4geyp9ICAgICAgICAgIFZhbHVlIG9mIHByb3BlcnR5IGlmIHNwZWNpZmllZCwgdGhlIGVudGlyZSBjb25maWcgb2JqZWN0IG90aGVyd2lzZVxuICAgICAgICAgKi9cbiAgICAgICAgZ2V0OiBmdW5jdGlvbiAocHJvcGVydHkpIHtcbiAgICAgICAgICAgIHJldHVybiBzZXJ2aWNlT3B0aW9uc1twcm9wZXJ0eV07XG4gICAgICAgIH0sXG5cbiAgICAgICAgLyoqXG4gICAgICAgICAqIFNldCBjb25maWd1cmF0aW9uLlxuICAgICAgICAgKiBAcGFyYW0gIHsgc3RyaW5nfE9iamVjdH0ga2V5IGlmIGEga2V5IGlzIHByb3ZpZGVkLCBzZXQgYSBrZXkgdG8gdGhhdCB2YWx1ZS4gT3RoZXJ3aXNlIG1lcmdlIG9iamVjdCB3aXRoIGN1cnJlbnQgY29uZmlnXG4gICAgICAgICAqIEBwYXJhbSAgeyp9IHZhbHVlICB2YWx1ZSBmb3IgcHJvdmlkZWQga2V5XG4gICAgICAgICAqL1xuICAgICAgICBzZXQ6IGZ1bmN0aW9uIChrZXksIHZhbHVlKSB7XG4gICAgICAgICAgICBzZXJ2aWNlT3B0aW9uc1trZXldID0gdmFsdWU7XG4gICAgICAgIH1cbiAgICB9O1xufTtcblxuIiwiLyoqXG4gKiAjI0RhdGEgQVBJIFNlcnZpY2VcbiAqXG4gKiBUaGUgRGF0YSBBUEkgU2VydmljZSBhbGxvd3MgeW91IHRvIGNyZWF0ZSwgYWNjZXNzLCBhbmQgbWFuaXB1bGF0ZSBkYXRhIHJlbGF0ZWQgdG8gYW55IG9mIHlvdXIgcHJvamVjdHMuIERhdGEgYXJlIG9yZ2FuaXplZCBpbiBjb2xsZWN0aW9ucy4gRWFjaCBjb2xsZWN0aW9uIGNvbnRhaW5zIGEgZG9jdW1lbnQ7IGVhY2ggZWxlbWVudCBvZiB0aGlzIHRvcC1sZXZlbCBkb2N1bWVudCBpcyBhIEpTT04gb2JqZWN0LiAoU2VlIGFkZGl0aW9uYWwgaW5mb3JtYXRpb24gb24gdGhlIHVuZGVybHlpbmcgW0RhdGEgQVBJXSguLi8uLi8uLi9yZXN0X2FwaXMvZGF0YV9hcGkvKS4pXG4gKlxuICogQWxsIEFQSSBjYWxscyB0YWtlIGluIGFuIFwib3B0aW9uc1wiIG9iamVjdCBhcyB0aGUgbGFzdCBwYXJhbWV0ZXIuIFRoZSBvcHRpb25zIGNhbiBiZSB1c2VkIHRvIGV4dGVuZC9vdmVycmlkZSB0aGUgRGF0YSBBUEkgU2VydmljZSBkZWZhdWx0cy4gSW4gcGFydGljdWxhciwgdGhlIGByb290YCBvcHRpb24gY29udGFpbnMgdGhlIG5hbWUgb2YgdGhlIGNvbGxlY3Rpb24uIElmIHlvdSBoYXZlIG11bHRpcGxlIGNvbGxlY3Rpb25zIHdpdGhpbiBlYWNoIG9mIHlvdXIgcHJvamVjdHMsIHlvdSBjYW4gcGFzcyB0aGUgY29sbGVjdGlvbiBuYW1lIGFzIGFuIG9wdGlvbiBmb3IgZWFjaCBjYWxsLlxuICpcbiAqICAgICAgdmFyIGRzID0gbmV3IEYuc2VydmljZS5EYXRhKHsgcm9vdDogJ3N1cnZleS1yZXNwb25zZXMnIH0pO1xuICogICAgICBkcy5zYXZlQXMoJ3VzZXIxJyxcbiAqICAgICAgICAgIHsgJ3F1ZXN0aW9uMSc6IDIsICdxdWVzdGlvbjInOiAxMCxcbiAqICAgICAgICAgICAncXVlc3Rpb24zJzogZmFsc2UsICdxdWVzdGlvbjQnOiAnc29tZXRpbWVzJyB9ICk7XG4gKiAgICAgIGRzLnNhdmVBcygndXNlcjInLFxuICogICAgICAgICAgeyAncXVlc3Rpb24xJzogMywgJ3F1ZXN0aW9uMic6IDgsXG4gKiAgICAgICAgICAgJ3F1ZXN0aW9uMyc6IHRydWUsICdxdWVzdGlvbjQnOiAnYWx3YXlzJyB9ICk7XG4gKiAgICAgIGRzLnF1ZXJ5KCcnLHsgJ3F1ZXN0aW9uMic6IHsgJyRndCc6IDl9IH0pO1xuICpcbiAqL1xuXG4ndXNlIHN0cmljdCc7XG5cbnZhciBDb25maWdTZXJ2aWNlID0gcmVxdWlyZSgnLi9jb25maWd1cmF0aW9uLXNlcnZpY2UnKTtcbnZhciBTdG9yYWdlRmFjdG9yeSA9IHJlcXVpcmUoJy4uL3N0b3JlL3N0b3JlLWZhY3RvcnknKTtcbnZhciBxdXRpbCA9IHJlcXVpcmUoJy4uL3V0aWwvcXVlcnktdXRpbCcpO1xudmFyIFRyYW5zcG9ydEZhY3RvcnkgPSByZXF1aXJlKCcuLi90cmFuc3BvcnQvaHR0cC10cmFuc3BvcnQtZmFjdG9yeScpO1xuXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uIChjb25maWcpIHtcbiAgICB2YXIgc3RvcmUgPSBuZXcgU3RvcmFnZUZhY3RvcnkoeyBzeW5jaHJvbm91czogdHJ1ZSB9KTtcblxuICAgIHZhciBkZWZhdWx0cyA9IHtcbiAgICAgICAgLyoqXG4gICAgICAgICAqIE5hbWUgb2YgY29sbGVjdGlvbi4gRGVmYXVsdHMgdG8gYC9gLCB0aGF0IGlzLCB0aGUgcm9vdCBsZXZlbCBvZiB5b3VyIHByb2plY3QgYXQgYGZvcmlvLmNvbS9hcHAveW91ci1hY2NvdW50LWlkL3lvdXItcHJvamVjdC1pZC9gLiBSZXF1aXJlZC5cbiAgICAgICAgICogQHR5cGUge1N0cmluZ31cbiAgICAgICAgICovXG4gICAgICAgIHJvb3Q6ICcvJyxcblxuICAgICAgICAvKipcbiAgICAgICAgICogRm9yIG9wZXJhdGlvbnMgdGhhdCByZXF1aXJlIGF1dGhlbnRpY2F0aW9uLCBwYXNzIGluIHRoZSB1c2VyIGFjY2VzcyB0b2tlbiAoZGVmYXVsdHMgdG8gZW1wdHkgc3RyaW5nKS4gSWYgdGhlIHVzZXIgaXMgYWxyZWFkeSBsb2dnZWQgaW4gdG8gRXBpY2VudGVyLCB0aGUgdXNlciBhY2Nlc3MgdG9rZW4gaXMgYWxyZWFkeSBzZXQgaW4gYSBjb29raWUgYW5kIGF1dG9tYXRpY2FsbHkgbG9hZGVkIGZyb20gdGhlcmUuIChTZWUgW21vcmUgYmFja2dyb3VuZCBvbiBhY2Nlc3MgdG9rZW5zXSguLi8uLi8uLi9wcm9qZWN0X2FjY2Vzcy8pKS5cbiAgICAgICAgICogQHNlZSBbQXV0aGVudGljYXRpb24gQVBJIFNlcnZpY2VdKC4uL2F1dGgtYXBpLXNlcnZpY2UvKSBmb3IgZ2V0dGluZyB0b2tlbnMuXG4gICAgICAgICAqIEB0eXBlIHtTdHJpbmd9XG4gICAgICAgICAqL1xuICAgICAgICB0b2tlbjogc3RvcmUuZ2V0KCdlcGljZW50ZXIucHJvamVjdC50b2tlbicpIHx8ICcnLFxuXG4gICAgICAgIGFwaUtleTogJycsXG4gICAgICAgIGRvbWFpbjogJ2ZvcmlvLmNvbScsXG5cbiAgICAgICAgLy9PcHRpb25zIHRvIHBhc3Mgb24gdG8gdGhlIHVuZGVybHlpbmcgdHJhbnNwb3J0IGxheWVyXG4gICAgICAgIHRyYW5zcG9ydDoge31cbiAgICB9O1xuICAgIHZhciBzZXJ2aWNlT3B0aW9ucyA9ICQuZXh0ZW5kKHt9LCBkZWZhdWx0cywgY29uZmlnKTtcblxuICAgIHZhciB1cmxDb25maWcgPSBuZXcgQ29uZmlnU2VydmljZShzZXJ2aWNlT3B0aW9ucykuZ2V0KCdzZXJ2ZXInKTtcbiAgICBpZiAoc2VydmljZU9wdGlvbnMuYWNjb3VudCkge1xuICAgICAgICB1cmxDb25maWcuYWNjb3VudFBhdGggPSBzZXJ2aWNlT3B0aW9ucy5hY2NvdW50O1xuICAgIH1cbiAgICBpZiAoc2VydmljZU9wdGlvbnMucHJvamVjdCkge1xuICAgICAgICB1cmxDb25maWcucHJvamVjdFBhdGggPSBzZXJ2aWNlT3B0aW9ucy5wcm9qZWN0O1xuICAgIH1cblxuICAgIHZhciBnZXRVUkwgPSBmdW5jdGlvbiAoa2V5LCByb290KSB7XG4gICAgICAgIGlmICghcm9vdCkge1xuICAgICAgICAgICAgcm9vdCA9IHNlcnZpY2VPcHRpb25zLnJvb3Q7XG4gICAgICAgIH1cbiAgICAgICAgdmFyIHVybCA9IHVybENvbmZpZy5nZXRBUElQYXRoKCdkYXRhJykgKyBxdXRpbC5hZGRUcmFpbGluZ1NsYXNoKHJvb3QpO1xuICAgICAgICBpZiAoa2V5KSB7XG4gICAgICAgICAgICB1cmwrPSBxdXRpbC5hZGRUcmFpbGluZ1NsYXNoKGtleSk7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHVybDtcbiAgICB9O1xuXG4gICAgdmFyIGh0dHBPcHRpb25zID0gJC5leHRlbmQodHJ1ZSwge30sIHNlcnZpY2VPcHRpb25zLnRyYW5zcG9ydCwge1xuICAgICAgICB1cmw6IGdldFVSTFxuICAgIH0pO1xuICAgIGlmIChzZXJ2aWNlT3B0aW9ucy50b2tlbikge1xuICAgICAgICBodHRwT3B0aW9ucy5oZWFkZXJzID0ge1xuICAgICAgICAgICAgJ0F1dGhvcml6YXRpb24nOiAnQmVhcmVyICcgKyBzZXJ2aWNlT3B0aW9ucy50b2tlblxuICAgICAgICB9O1xuICAgIH1cbiAgICB2YXIgaHR0cCA9IG5ldyBUcmFuc3BvcnRGYWN0b3J5KGh0dHBPcHRpb25zKTtcblxuICAgIHZhciBwdWJsaWNBUEkgPSB7XG5cbiAgICAgICAgLyoqXG4gICAgICAgICAqIFNlYXJjaCBmb3IgZGF0YSB3aXRoaW4gYSBjb2xsZWN0aW9uLlxuICAgICAgICAgKlxuICAgICAgICAgKiBTZWFyY2hpbmcgdXNpbmcgY29tcGFyaXNvbiBvciBsb2dpY2FsIG9wZXJhdG9ycyAoYXMgb3Bwb3NlZCB0byBleGFjdCBtYXRjaGVzKSByZXF1aXJlcyBNb25nb0RCIHN5bnRheC4gU2VlIHRoZSB1bmRlcmx5aW5nIFtEYXRhIEFQSV0oLi4vLi4vLi4vcmVzdF9hcGlzL2RhdGFfYXBpLyNzZWFyY2hpbmcpIGZvciBhZGRpdGlvbmFsIGRldGFpbHMuXG4gICAgICAgICAqXG4gICAgICAgICAqICoqRXhhbXBsZXMqKlxuICAgICAgICAgKlxuICAgICAgICAgKiAgICAgIC8vIHJlcXVlc3QgYWxsIGRhdGEgYXNzb2NpYXRlZCB3aXRoIGRvY3VtZW50ICd1c2VyMSdcbiAgICAgICAgICogICAgICBkcy5xdWVyeSgndXNlcjEnKTtcbiAgICAgICAgICpcbiAgICAgICAgICogICAgICAvLyBleGFjdCBtYXRjaGluZzpcbiAgICAgICAgICogICAgICAvLyByZXF1ZXN0IGFsbCBkb2N1bWVudHMgaW4gY29sbGVjdGlvbiB3aGVyZSAncXVlc3Rpb24yJyBpcyA5XG4gICAgICAgICAqICAgICAgZHMucXVlcnkoJycsIHsgJ3F1ZXN0aW9uMic6IDl9KTtcbiAgICAgICAgICpcbiAgICAgICAgICogICAgICAvLyBjb21wYXJpc29uIG9wZXJhdG9yczpcbiAgICAgICAgICogICAgICAvLyByZXF1ZXN0IGFsbCBkb2N1bWVudHMgaW4gY29sbGVjdGlvblxuICAgICAgICAgKiAgICAgIC8vIHdoZXJlICdxdWVzdGlvbjInIGlzIGdyZWF0ZXIgdGhhbiA5XG4gICAgICAgICAqICAgICAgZHMucXVlcnkoJycsIHsgJ3F1ZXN0aW9uMic6IHsgJyRndCc6IDl9IH0pO1xuICAgICAgICAgKlxuICAgICAgICAgKiAgICAgIC8vIGxvZ2ljYWwgb3BlcmF0b3JzOlxuICAgICAgICAgKiAgICAgIC8vIHJlcXVlc3QgYWxsIGRvY3VtZW50cyBpbiBjb2xsZWN0aW9uXG4gICAgICAgICAqICAgICAgLy8gd2hlcmUgJ3F1ZXN0aW9uMicgaXMgbGVzcyB0aGFuIDEwLCBhbmQgJ3F1ZXN0aW9uMycgaXMgZmFsc2VcbiAgICAgICAgICogICAgICBkcy5xdWVyeSgnJywgeyAnJGFuZCc6IFsgeyAncXVlc3Rpb24yJzogeyAnJGx0JzoxMH0gfSwgeyAncXVlc3Rpb24zJzogZmFsc2UgfV0gfSk7XG4gICAgICAgICAqXG4gICAgICAgICAqICAgICAgLy8gcmVndWxhciBleHByZXNzc2lvbnM6IHVzZSBhbnkgUGVybC1jb21wYXRpYmxlIHJlZ3VsYXIgZXhwcmVzc2lvbnNcbiAgICAgICAgICogICAgICAvLyByZXF1ZXN0IGFsbCBkb2N1bWVudHMgaW4gY29sbGVjdGlvblxuICAgICAgICAgKiAgICAgIC8vIHdoZXJlICdxdWVzdGlvbjUnIGNvbnRhaW5zIHRoZSBzdHJpbmcgJypkYXknXG4gICAgICAgICAqICAgICAgZHMucXVlcnkoJycsIHsgJ3F1ZXN0aW9uNSc6IHsgJyRyZWdleCc6ICcqZGF5JyB9IH0pO1xuICAgICAgICAgKlxuICAgICAgICAgKiAqKlBhcmFtZXRlcnMqKlxuICAgICAgICAgKiBAcGFyYW0ge1N0cmluZ30gYGtleWAgVGhlIG5hbWUgb2YgdGhlIGRvY3VtZW50IHRvIHNlYXJjaC4gUGFzcyB0aGUgZW1wdHkgc3RyaW5nICgnJykgdG8gc2VhcmNoIHRoZSBlbnRpcmUgY29sbGVjdGlvbi5cbiAgICAgICAgICogQHBhcmFtIHtPYmplY3R9IGBxdWVyeWAgVGhlIHF1ZXJ5IG9iamVjdC4gRm9yIGV4YWN0IG1hdGNoaW5nLCB0aGlzIG9iamVjdCBjb250YWlucyB0aGUgZmllbGQgbmFtZSBhbmQgZmllbGQgdmFsdWUgdG8gbWF0Y2guIEZvciBtYXRjaGluZyBiYXNlZCBvbiBjb21wYXJpc29uLCB0aGlzIG9iamVjdCBjb250YWlucyB0aGUgZmllbGQgbmFtZSBhbmQgdGhlIGNvbXBhcmlzb24gZXhwcmVzc2lvbi4gRm9yIG1hdGNoaW5nIGJhc2VkIG9uIGxvZ2ljYWwgb3BlcmF0b3JzLCB0aGlzIG9iamVjdCBjb250YWlucyBhbiBleHByZXNzaW9uIHVzaW5nIE1vbmdvREIgc3ludGF4LiBTZWUgdGhlIHVuZGVybHlpbmcgW0RhdGEgQVBJXSguLi8uLi8uLi9yZXN0X2FwaXMvZGF0YV9hcGkvI3NlYXJjaGluZykgZm9yIGFkZGl0aW9uYWwgZXhhbXBsZXMuXG4gICAgICAgICAqIEBwYXJhbSB7T2JqZWN0fSBgb3V0cHV0TW9kaWZpZXJgIChPcHRpb25hbCkgQXZhaWxhYmxlIGZpZWxkcyBpbmNsdWRlOiBgc3RhcnRyZWNvcmRgLCBgZW5kcmVjb3JkYCwgYHNvcnRgLCBhbmQgYGRpcmVjdGlvbmAgKGBhc2NgIG9yIGBkZXNjYCkuXG4gICAgICAgICAqIEBwYXJhbSB7T2JqZWN0fSBgb3B0aW9uc2AgKE9wdGlvbmFsKSBPdmVycmlkZXMgZm9yIGNvbmZpZ3VyYXRpb24gb3B0aW9ucy5cbiAgICAgICAgICpcbiAgICAgICAgICovXG4gICAgICAgIHF1ZXJ5OiBmdW5jdGlvbiAoa2V5LCBxdWVyeSwgb3V0cHV0TW9kaWZpZXIsIG9wdGlvbnMpIHtcbiAgICAgICAgICAgIHZhciBwYXJhbXMgPSAkLmV4dGVuZCh0cnVlLCB7IHE6IHF1ZXJ5IH0sIG91dHB1dE1vZGlmaWVyKTtcbiAgICAgICAgICAgIHZhciBodHRwT3B0aW9ucyA9ICQuZXh0ZW5kKHRydWUsIHt9LCBzZXJ2aWNlT3B0aW9ucywgb3B0aW9ucyk7XG4gICAgICAgICAgICBodHRwT3B0aW9ucy51cmwgPSBnZXRVUkwoa2V5LCBodHRwT3B0aW9ucy5yb290KTtcbiAgICAgICAgICAgIHJldHVybiBodHRwLmdldChwYXJhbXMsIGh0dHBPcHRpb25zKTtcbiAgICAgICAgfSxcblxuICAgICAgICAvKipcbiAgICAgICAgICogU2F2ZSBkYXRhIHRvIGFuIGFub255bW91cyBkb2N1bWVudCB3aXRoaW4gdGhlIGNvbGxlY3Rpb24uXG4gICAgICAgICAqXG4gICAgICAgICAqIChEb2N1bWVudHMgYXJlIHRvcC1sZXZlbCBlbGVtZW50cyB3aXRoaW4gYSBjb2xsZWN0aW9uLiBDb2xsZWN0aW9ucyBtdXN0IGJlIHVuaXF1ZSB3aXRoaW4gdGhpcyBhY2NvdW50ICh0ZWFtIG9yIHBlcnNvbmFsIGFjY291bnQpIGFuZCBwcm9qZWN0IGFuZCBhcmUgc2V0IHdpdGggdGhlIGByb290YCBmaWVsZCBpbiB0aGUgYG9wdGlvbmAgcGFyYW1ldGVyLiBTZWUgdGhlIHVuZGVybHlpbmcgW0RhdGEgQVBJXSguLi8uLi8uLi9yZXN0X2FwaXMvZGF0YV9hcGkvKSBmb3IgYWRkaXRpb25hbCBiYWNrZ3JvdW5kLilcbiAgICAgICAgICpcbiAgICAgICAgICogKipFeGFtcGxlKipcbiAgICAgICAgICpcbiAgICAgICAgICogICAgICBkcy5zYXZlKCdxdWVzdGlvbjEnLCAneWVzJyk7XG4gICAgICAgICAqICAgICAgZHMuc2F2ZSh7cXVlc3Rpb24xOid5ZXMnLCBxdWVzdGlvbjI6IDMyIH0pO1xuICAgICAgICAgKiAgICAgIGRzLnNhdmUoeyBuYW1lOidKb2huJywgY2xhc3NOYW1lOiAnQ1MxMDEnIH0sIHsgcm9vdDogJ3N0dWRlbnRzJyB9KTtcbiAgICAgICAgICpcbiAgICAgICAgICogKipQYXJhbWV0ZXJzKipcbiAgICAgICAgICpcbiAgICAgICAgICogQHBhcmFtIHtTdHJpbmd8T2JqZWN0fSBga2V5YCBJZiBga2V5YCBpcyBhIHN0cmluZywgaXQgaXMgdGhlIGlkIG9mIHRoZSBlbGVtZW50IHRvIHNhdmUgKGNyZWF0ZSkgaW4gdGhpcyBkb2N1bWVudC4gSWYgYGtleWAgaXMgYW4gb2JqZWN0LCB0aGUgb2JqZWN0IGlzIHRoZSBkYXRhIHRvIHNhdmUgKGNyZWF0ZSkgaW4gdGhpcyBkb2N1bWVudC4gSW4gYm90aCBjYXNlcywgdGhlIGlkIGZvciB0aGUgZG9jdW1lbnQgaXMgZ2VuZXJhdGVkIGF1dG9tYXRpY2FsbHkuXG4gICAgICAgICAqIEBwYXJhbSB7T2JqZWN0fSBgdmFsdWVgIChPcHRpb25hbCkgVGhlIGRhdGEgdG8gc2F2ZS4gSWYgYGtleWAgaXMgYSBzdHJpbmcsIHRoaXMgaXMgdGhlIHZhbHVlIHRvIHNhdmUuIElmIGBrZXlgIGlzIGFuIG9iamVjdCwgdGhlIHZhbHVlKHMpIHRvIHNhdmUgYXJlIGFscmVhZHkgcGFydCBvZiBga2V5YCBhbmQgdGhpcyBhcmd1bWVudCBpcyBub3QgcmVxdWlyZWQuXG4gICAgICAgICAqIEBwYXJhbSB7T2JqZWN0fSBgb3B0aW9uc2AgKE9wdGlvbmFsKSBPdmVycmlkZXMgZm9yIGNvbmZpZ3VyYXRpb24gb3B0aW9ucy5cbiAgICAgICAgICovXG4gICAgICAgIHNhdmU6IGZ1bmN0aW9uIChrZXksIHZhbHVlLCBvcHRpb25zKSB7XG4gICAgICAgICAgICB2YXIgYXR0cnM7XG4gICAgICAgICAgICBpZiAodHlwZW9mIGtleSA9PT0gJ29iamVjdCcpIHtcbiAgICAgICAgICAgICAgICBhdHRycyA9IGtleTtcbiAgICAgICAgICAgICAgICBvcHRpb25zID0gdmFsdWU7XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIChhdHRycyA9IHt9KVtrZXldID0gdmFsdWU7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICB2YXIgaHR0cE9wdGlvbnMgPSAkLmV4dGVuZCh0cnVlLCB7fSwgc2VydmljZU9wdGlvbnMsIG9wdGlvbnMpO1xuICAgICAgICAgICAgaHR0cE9wdGlvbnMudXJsID0gZ2V0VVJMKCcnLCBodHRwT3B0aW9ucy5yb290KTtcblxuICAgICAgICAgICAgcmV0dXJuIGh0dHAucG9zdChhdHRycywgaHR0cE9wdGlvbnMpO1xuICAgICAgICB9LFxuXG4gICAgICAgIC8qKlxuICAgICAgICAgKiBTYXZlIGRhdGEgdG8gYSBuYW1lZCBkb2N1bWVudCBvciBlbGVtZW50IHdpdGhpbiB0aGUgY29sbGVjdGlvbi4gVGhlIGByb290YCBvZiB0aGUgY29sbGVjdGlvbiBtdXN0IGJlIHNwZWNpZmllZCBzZXBhcmF0ZWx5IGluIGNvbmZpZ3VyYXRpb24gb3B0aW9ucywgZWl0aGVyIGFzIHBhcnQgb2YgdGhlIGNhbGwgb3IgYXMgcGFydCBvZiB0aGUgaW5pdGlhbGl6YXRpb24gb2YgZHMuXG4gICAgICAgICAqXG4gICAgICAgICAqIChEb2N1bWVudHMgYXJlIHRvcC1sZXZlbCBlbGVtZW50cyB3aXRoaW4gYSBjb2xsZWN0aW9uLiBDb2xsZWN0aW9ucyBtdXN0IGJlIHVuaXF1ZSB3aXRoaW4gdGhpcyBhY2NvdW50ICh0ZWFtIG9yIHBlcnNvbmFsIGFjY291bnQpIGFuZCBwcm9qZWN0IGFuZCBhcmUgc2V0IHdpdGggdGhlIGByb290YCBmaWVsZCBpbiB0aGUgYG9wdGlvbmAgcGFyYW1ldGVyLiBTZWUgdGhlIHVuZGVybHlpbmcgW0RhdGEgQVBJXSguLi8uLi8uLi9yZXN0X2FwaXMvZGF0YV9hcGkvKSBmb3IgYWRkaXRpb25hbCBiYWNrZ3JvdW5kLilcbiAgICAgICAgICpcbiAgICAgICAgICogKipFeGFtcGxlKipcbiAgICAgICAgICpcbiAgICAgICAgICogICAgICBkcy5zYXZlQXMoJ3VzZXIxJyxcbiAgICAgICAgICogICAgICAgICAgeyAncXVlc3Rpb24xJzogMiwgJ3F1ZXN0aW9uMic6IDEwLFxuICAgICAgICAgKiAgICAgICAgICAgJ3F1ZXN0aW9uMyc6IGZhbHNlLCAncXVlc3Rpb240JzogJ3NvbWV0aW1lcycgfSApO1xuICAgICAgICAgKiAgICAgIGRzLnNhdmVBcygnc3R1ZGVudDEnLFxuICAgICAgICAgKiAgICAgICAgICB7IGZpcnN0TmFtZTogJ2pvaG4nLCBsYXN0TmFtZTogJ3NtaXRoJyB9LFxuICAgICAgICAgKiAgICAgICAgICB7IHJvb3Q6ICdzdHVkZW50cycgfSk7XG4gICAgICAgICAqICAgICAgZHMuc2F2ZUFzKCdtZ210MTAwL2dyb3VwQicsXG4gICAgICAgICAqICAgICAgICAgIHsgc2NlbmFyaW9ZZWFyOiAnMjAxNScgfSxcbiAgICAgICAgICogICAgICAgICAgeyByb290OiAnbXljbGFzc2VzJyB9KTtcbiAgICAgICAgICpcbiAgICAgICAgICogKipQYXJhbWV0ZXJzKipcbiAgICAgICAgICpcbiAgICAgICAgICogQHBhcmFtIHtTdHJpbmd9IGBrZXlgIElkIG9mIHRoZSBkb2N1bWVudC5cbiAgICAgICAgICogQHBhcmFtIHtPYmplY3R9IGB2YWx1ZWAgKE9wdGlvbmFsKSBUaGUgZGF0YSB0byBzYXZlLCBpbiBrZXk6dmFsdWUgcGFpcnMuXG4gICAgICAgICAqIEBwYXJhbSB7T2JqZWN0fSBgb3B0aW9uc2AgKE9wdGlvbmFsKSBPdmVycmlkZXMgZm9yIGNvbmZpZ3VyYXRpb24gb3B0aW9ucy5cbiAgICAgICAgICovXG4gICAgICAgIHNhdmVBczogZnVuY3Rpb24gKGtleSwgdmFsdWUsIG9wdGlvbnMpIHtcbiAgICAgICAgICAgIHZhciBodHRwT3B0aW9ucyA9ICQuZXh0ZW5kKHRydWUsIHt9LCBzZXJ2aWNlT3B0aW9ucywgb3B0aW9ucyk7XG4gICAgICAgICAgICBodHRwT3B0aW9ucy51cmwgPSBnZXRVUkwoa2V5LCBodHRwT3B0aW9ucy5yb290KTtcblxuICAgICAgICAgICAgcmV0dXJuIGh0dHAucHV0KHZhbHVlLCBodHRwT3B0aW9ucyk7XG4gICAgICAgIH0sXG5cbiAgICAgICAgLyoqXG4gICAgICAgICAqIEdldCBkYXRhIGZvciBhIHNwZWNpZmljIGRvY3VtZW50IG9yIGZpZWxkLlxuICAgICAgICAgKlxuICAgICAgICAgKiAqKkV4YW1wbGUqKlxuICAgICAgICAgKlxuICAgICAgICAgKiAgICAgIGRzLmxvYWQoJ3VzZXIxJyk7XG4gICAgICAgICAqICAgICAgZHMubG9hZCgndXNlcjEvcXVlc3Rpb24zJyk7XG4gICAgICAgICAqXG4gICAgICAgICAqICoqUGFyYW1ldGVycyoqXG4gICAgICAgICAqIEBwYXJhbSAge1N0cmluZ3xPYmplY3R9IGBrZXlgIFRoZSBpZCBvZiB0aGUgZGF0YSB0byByZXR1cm4uIENhbiBiZSB0aGUgaWQgb2YgYSBkb2N1bWVudCwgb3IgYSBwYXRoIHRvIGRhdGEgd2l0aGluIHRoYXQgZG9jdW1lbnQuXG4gICAgICAgICAqIEBwYXJhbSB7T2JqZWN0fSBgb3V0cHV0TW9kaWZpZXJgIChPcHRpb25hbCkgQXZhaWxhYmxlIGZpZWxkcyBpbmNsdWRlOiBgc3RhcnRyZWNvcmRgLCBgZW5kcmVjb3JkYCwgYHNvcnRgLCBhbmQgYGRpcmVjdGlvbmAgKGBhc2NgIG9yIGBkZXNjYCkuXG4gICAgICAgICAqIEBwYXJhbSB7T2JqZWN0fSBgb3B0aW9uc2AgT3ZlcnJpZGVzIGZvciBjb25maWd1cmF0aW9uIG9wdGlvbnMuXG4gICAgICAgICAqL1xuICAgICAgICBsb2FkOiBmdW5jdGlvbiAoa2V5LCBvdXRwdXRNb2RpZmllciwgb3B0aW9ucykge1xuICAgICAgICAgICAgdmFyIGh0dHBPcHRpb25zID0gJC5leHRlbmQodHJ1ZSwge30sIHNlcnZpY2VPcHRpb25zLCBvcHRpb25zKTtcbiAgICAgICAgICAgIGh0dHBPcHRpb25zLnVybCA9IGdldFVSTChrZXksIGh0dHBPcHRpb25zLnJvb3QpO1xuICAgICAgICAgICAgcmV0dXJuIGh0dHAuZ2V0KG91dHB1dE1vZGlmaWVyLCBodHRwT3B0aW9ucyk7XG4gICAgICAgIH0sXG5cbiAgICAgICAgLyoqXG4gICAgICAgICAqIFJlbW92ZXMgZGF0YSBmcm9tIGNvbGxlY3Rpb24uIE9ubHkgZG9jdW1lbnRzICh0b3AtbGV2ZWwgZWxlbWVudHMgaW4gZWFjaCBjb2xsZWN0aW9uKSBjYW4gYmUgZGVsZXRlZC5cbiAgICAgICAgICpcbiAgICAgICAgICogKipFeGFtcGxlKipcbiAgICAgICAgICpcbiAgICAgICAgICogICAgIGRzLnJlbW92ZSgndXNlcjEnKTtcbiAgICAgICAgICpcbiAgICAgICAgICpcbiAgICAgICAgICogKipQYXJhbWV0ZXJzKipcbiAgICAgICAgICpcbiAgICAgICAgICogQHBhcmFtIHtTdHJpbmd9IGBrZXlgIFRoZSBpZCBvZiB0aGUgZG9jdW1lbnQgdG8gcmVtb3ZlIGZyb20gdGhpcyBjb2xsZWN0aW9uLlxuICAgICAgICAgKiBAcGFyYW0ge09iamVjdH0gYG9wdGlvbnNgIChPcHRpb25hbCkgT3ZlcnJpZGVzIGZvciBjb25maWd1cmF0aW9uIG9wdGlvbnMuXG4gICAgICAgICAqL1xuICAgICAgICByZW1vdmU6IGZ1bmN0aW9uIChrZXlzLCBvcHRpb25zKSB7XG4gICAgICAgICAgICB2YXIgaHR0cE9wdGlvbnMgPSAkLmV4dGVuZCh0cnVlLCB7fSwgc2VydmljZU9wdGlvbnMsIG9wdGlvbnMpO1xuICAgICAgICAgICAgdmFyIHBhcmFtcztcbiAgICAgICAgICAgIGlmICgkLmlzQXJyYXkoa2V5cykpIHtcbiAgICAgICAgICAgICAgICBwYXJhbXMgPSB7IGlkOiBrZXlzIH07XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIHBhcmFtcyA9ICcnO1xuICAgICAgICAgICAgICAgIGh0dHBPcHRpb25zLnVybCA9IGdldFVSTChrZXlzLCBodHRwT3B0aW9ucy5yb290KTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJldHVybiBodHRwLmRlbGV0ZShwYXJhbXMsIGh0dHBPcHRpb25zKTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIEVwaWNlbnRlciBkb2Vzbid0IGFsbG93IG51a2luZyBjb2xsZWN0aW9uc1xuICAgICAgICAvLyAgICAgLyoqXG4gICAgICAgIC8vICAgICAgKiBSZW1vdmVzIGNvbGxlY3Rpb24gYmVpbmcgcmVmZXJlbmNlZFxuICAgICAgICAvLyAgICAgICogQHJldHVybiBudWxsXG4gICAgICAgIC8vICAgICAgKi9cbiAgICAgICAgLy8gICAgIGRlc3Ryb3k6IGZ1bmN0aW9uIChvcHRpb25zKSB7XG4gICAgICAgIC8vICAgICAgICAgcmV0dXJuIHRoaXMucmVtb3ZlKCcnLCBvcHRpb25zKTtcbiAgICAgICAgLy8gICAgIH1cbiAgICB9O1xuXG4gICAgJC5leHRlbmQodGhpcywgcHVibGljQVBJKTtcbn07XG4iLCIvKipcbiAqXG4gKiAjI01lbWJlciBBUEkgQWRhcHRlclxuICpcbiAqIFRoZSBNZW1iZXIgQVBJIEFkYXB0ZXIgcHJvdmlkZXMgbWV0aG9kcyB0byBsb29rdXAgdXNlciBkZXRhaWxzIG9yIGdyb3VwIGRldGFpbHNcbiAqXG4gKiAgICAgIHZhciBhdXRoID0gbmV3IEYuYWRhcHRlci5NZW1iZXIoKTtcbiAqICAgICAgYXV0aC5nZXRHcm91cHNCeVVzZXIoeyB1c2VySWQ6ICdiNmIzMTNhMy1hYjg0LTQ3OWMtYmFlYS0yMDZmNmJmZjMzNycgfSk7XG4gKiAgICAgIGF1dGguZ2V0R3JvdXBEZXRhaWxzKHsgZ3JvdXBJZDogJzAwYjUzMzA4LTk4MzMtNDdmMi1iMjFlLTEyNzhjMDdkNTNiOCcgfSk7XG4gKi9cblxuJ3VzZSBzdHJpY3QnO1xuXG52YXIgQ29uZmlnU2VydmljZSA9IHJlcXVpcmUoJy4vY29uZmlndXJhdGlvbi1zZXJ2aWNlJyk7XG52YXIgVHJhbnNwb3J0RmFjdG9yeSA9IHJlcXVpcmUoJy4uL3RyYW5zcG9ydC9odHRwLXRyYW5zcG9ydC1mYWN0b3J5Jyk7XG52YXIgX3BpY2sgPSByZXF1aXJlKCcuLi91dGlsL29iamVjdC11dGlsJykuX3BpY2s7XG52YXIgYXBpRW5kcG9pbnQgPSAnbWVtYmVyL2xvY2FsJztcblxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbiAoY29uZmlnKSB7XG4gICAgdmFyIGRlZmF1bHRzID0ge1xuICAgICAgICAvKipcbiAgICAgICAgICogRXBpY2VudGVyIHVzZXJJZC4gRGVmYXVsdHMgdG8gYSBibGFuayBzdHJpbmdcbiAgICAgICAgICogQHR5cGUgeyBzdHJpbmd9XG4gICAgICAgICAqL1xuICAgICAgICB1c2VySWQ6ICcnLFxuXG4gICAgICAgIC8qKlxuICAgICAgICAgKiBFcGljZW50ZXIgZ3JvdXBJZC4gRGVmYXVsdHMgdG8gYSBibGFuayBzdHJpbmdcbiAgICAgICAgICogQHR5cGUgeyBzdHJpbmd9XG4gICAgICAgICAqL1xuICAgICAgICBncm91cElkOiAnJyxcblxuICAgICAgICAvKipcbiAgICAgICAgICogT3B0aW9ucyB0byBwYXNzIG9uIHRvIHRoZSB1bmRlcmx5aW5nIHRyYW5zcG9ydCBsYXllci4gQWxsIGpxdWVyeS5hamF4IG9wdGlvbnMgYXQgaHR0cDovL2FwaS5qcXVlcnkuY29tL2pRdWVyeS5hamF4LyBhcmUgYXZhaWxhYmxlLiBEZWZhdWx0cyB0byBlbXB0eSBvYmplY3QuXG4gICAgICAgICAqIEB0eXBlIHtvYmplY3R9XG4gICAgICAgICAqL1xuICAgICAgICB0cmFuc3BvcnQ6IHt9XG4gICAgfTtcbiAgICB2YXIgc2VydmljZU9wdGlvbnMgPSAkLmV4dGVuZCh7fSwgZGVmYXVsdHMsIGNvbmZpZyk7XG4gICAgdmFyIHVybENvbmZpZyA9IG5ldyBDb25maWdTZXJ2aWNlKHNlcnZpY2VPcHRpb25zKS5nZXQoJ3NlcnZlcicpO1xuXG4gICAgdmFyIHRyYW5zcG9ydE9wdGlvbnMgPSAkLmV4dGVuZCh0cnVlLCB7fSwgc2VydmljZU9wdGlvbnMudHJhbnNwb3J0LCB7XG4gICAgICAgIHVybDogdXJsQ29uZmlnLmdldEFQSVBhdGgoYXBpRW5kcG9pbnQpXG4gICAgfSk7XG5cbiAgICBpZiAoc2VydmljZU9wdGlvbnMudG9rZW4pIHtcbiAgICAgICAgdHJhbnNwb3J0T3B0aW9ucy5oZWFkZXJzID0ge1xuICAgICAgICAgICAgJ0F1dGhvcml6YXRpb24nOiAnQmVhcmVyICcgKyBzZXJ2aWNlT3B0aW9ucy50b2tlblxuICAgICAgICB9O1xuICAgIH1cbiAgICB2YXIgaHR0cCA9IG5ldyBUcmFuc3BvcnRGYWN0b3J5KHRyYW5zcG9ydE9wdGlvbnMsIHNlcnZpY2VPcHRpb25zKTtcblxuICAgIHZhciBnZXRGaW5hbFBhcmFtcyA9IGZ1bmN0aW9uIChwYXJhbXMpIHtcbiAgICAgICAgaWYgKHR5cGVvZiBwYXJhbXMgPT09ICdvYmplY3QnKSB7XG4gICAgICAgICAgICByZXR1cm4gJC5leHRlbmQodHJ1ZSwgc2VydmljZU9wdGlvbnMsIHBhcmFtcyk7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHNlcnZpY2VPcHRpb25zO1xuICAgIH07XG5cbiAgICB2YXIgcGF0Y2hVc2VyQWN0aXZlRmllbGQgPSBmdW5jdGlvbiAocGFyYW1zLCBhY3RpdmUsIG9wdGlvbnMpIHtcbiAgICAgICAgdmFyIGh0dHBPcHRpb25zID0gJC5leHRlbmQodHJ1ZSwgc2VydmljZU9wdGlvbnMsIG9wdGlvbnMsIHtcbiAgICAgICAgICAgIHVybDogdXJsQ29uZmlnLmdldEFQSVBhdGgoYXBpRW5kcG9pbnQpICsgcGFyYW1zLmdyb3VwSWQgKyAnLycgKyBwYXJhbXMudXNlcklkXG4gICAgICAgIH0pO1xuXG4gICAgICAgIHJldHVybiBodHRwLnBhdGNoKHsgYWN0aXZlOiBhY3RpdmUgfSwgaHR0cE9wdGlvbnMpO1xuICAgIH07XG5cbiAgICB2YXIgcHVibGljQVBJID0ge1xuXG4gICAgICAgIGdldEdyb3Vwc0J5VXNlcjogZnVuY3Rpb24gKHBhcmFtcywgb3B0aW9ucykge1xuICAgICAgICAgICAgb3B0aW9ucyA9IG9wdGlvbnMgfHwge307XG4gICAgICAgICAgICB2YXIgaHR0cE9wdGlvbnMgPSAkLmV4dGVuZCh0cnVlLCBzZXJ2aWNlT3B0aW9ucywgb3B0aW9ucyk7XG4gICAgICAgICAgICB2YXIgaXNTdHJpbmcgPSB0eXBlb2YgcGFyYW1zID09PSAnc3RyaW5nJztcbiAgICAgICAgICAgIHZhciBvYmpQYXJhbXMgPSBnZXRGaW5hbFBhcmFtcyhwYXJhbXMpO1xuICAgICAgICAgICAgaWYgKCFpc1N0cmluZyAmJiAhb2JqUGFyYW1zLnVzZXJJZCkge1xuICAgICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcignTm8gdXNlcklkIHNwZWNpZmllZC4nKTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgdmFyIGdldFBhcm1zID0gaXNTdHJpbmcgPyB7IHVzZXJJZDogcGFyYW1zIH0gOiBfcGljayhvYmpQYXJhbXMsICd1c2VySWQnKTtcbiAgICAgICAgICAgIHJldHVybiBodHRwLmdldChnZXRQYXJtcywgaHR0cE9wdGlvbnMpO1xuICAgICAgICB9LFxuXG4gICAgICAgIGdldEdyb3VwRGV0YWlsczogZnVuY3Rpb24gKHBhcmFtcywgb3B0aW9ucykge1xuICAgICAgICAgICAgb3B0aW9ucyA9IG9wdGlvbnMgfHwge307XG4gICAgICAgICAgICB2YXIgaXNTdHJpbmcgPSB0eXBlb2YgcGFyYW1zID09PSAnc3RyaW5nJztcbiAgICAgICAgICAgIHZhciBvYmpQYXJhbXMgPSBnZXRGaW5hbFBhcmFtcyhwYXJhbXMpO1xuICAgICAgICAgICAgaWYgKCFpc1N0cmluZyAmJiAhb2JqUGFyYW1zLmdyb3VwSWQpIHtcbiAgICAgICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ05vIGdyb3VwSWQgc3BlY2lmaWVkLicpO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICB2YXIgZ3JvdXBJZCA9IGlzU3RyaW5nID8gcGFyYW1zIDogb2JqUGFyYW1zLmdyb3VwSWQ7XG4gICAgICAgICAgICB2YXIgaHR0cE9wdGlvbnMgPSAkLmV4dGVuZCh0cnVlLCBzZXJ2aWNlT3B0aW9ucyxcbiAgICAgICAgICAgICAgICBvcHRpb25zLFxuICAgICAgICAgICAgICAgIHsgdXJsOiB1cmxDb25maWcuZ2V0QVBJUGF0aChhcGlFbmRwb2ludCkgKyBncm91cElkIH1cbiAgICAgICAgICAgICk7XG5cbiAgICAgICAgICAgIHJldHVybiBodHRwLmdldCh7fSwgaHR0cE9wdGlvbnMpO1xuICAgICAgICB9LFxuXG4gICAgICAgIG1ha2VVc2VyQWN0aXZlOiBmdW5jdGlvbiAocGFyYW1zLCBvcHRpb25zKSB7XG4gICAgICAgICAgICByZXR1cm4gcGF0Y2hVc2VyQWN0aXZlRmllbGQocGFyYW1zLCB0cnVlLCBvcHRpb25zKTtcbiAgICAgICAgfSxcblxuICAgICAgICBtYWtlVXNlckluYWN0aXZlOiBmdW5jdGlvbiAocGFyYW1zLCBvcHRpb25zKSB7XG4gICAgICAgICAgICByZXR1cm4gcGF0Y2hVc2VyQWN0aXZlRmllbGQocGFyYW1zLCBmYWxzZSwgb3B0aW9ucyk7XG4gICAgICAgIH1cbiAgICB9O1xuXG4gICAgJC5leHRlbmQodGhpcywgcHVibGljQVBJKTtcbn07XG4iLCIvKipcbiAqXG4gKiAjI1J1biBBUEkgU2VydmljZVxuICpcbiAqIFRoZSBSdW4gQVBJIFNlcnZpY2UgYWxsb3dzIHlvdSB0byBwZXJmb3JtIGNvbW1vbiB0YXNrcyBhcm91bmQgY3JlYXRpbmcgYW5kIHVwZGF0aW5nIHJ1bnMsIHZhcmlhYmxlcywgYW5kIGRhdGEuXG4gKlxuICogQWxsIEFQSSBjYWxscyB0YWtlIGluIGFuIFwib3B0aW9uc1wiIG9iamVjdCBhcyB0aGUgbGFzdCBwYXJhbWV0ZXIuIFRoZSBvcHRpb25zIGNhbiBiZSB1c2VkIHRvIGV4dGVuZC9vdmVycmlkZSB0aGUgUnVuIEFQSSBTZXJ2aWNlIGRlZmF1bHRzLlxuICpcbiAqIFR5cGljYWxseSwgeW91IGZpcnN0IGluc3RhbnRpYXRlIGEgW1J1biBNYW5hZ2VyXSguLi9ydW4tbWFuYWdlci8pIGFuZCB0aGVuIGFjY2VzcyB0aGUgUnVuIFNlcnZpY2UgdGhhdCBpcyBhdXRvbWF0aWNhbGx5IHBhcnQgb2YgdGhlIG1hbmFnZXIuXG4gKlxuICogICAgICAgdmFyIHJtID0gbmV3IEYubWFuYWdlci5SdW5NYW5hZ2VyKHtcbiAqICAgICAgICAgICBydW46IHtcbiAqICAgICAgICAgICAgICAgYWNjb3VudDogJ2FjbWUtc2ltdWxhdGlvbnMnLFxuICogICAgICAgICAgICAgICBwcm9qZWN0OiAnc3VwcGx5LWNoYWluLWdhbWUnLFxuICogICAgICAgICAgICAgICBtb2RlbDogJ3N1cHBseS1jaGFpbi1tb2RlbC5qbCdcbiAqICAgICAgICAgICB9XG4gKiAgICAgICB9KTtcbiAqICAgICAgIHJtLmdldFJ1bigpXG4gKiAgICAgICAgICAgLnRoZW4oZnVuY3Rpb24oKSB7XG4gKiAgICAgICAgICAgICAgIC8vIHRoZSBSdW5NYW5hZ2VyLnJ1biBjb250YWlucyB0aGUgaW5zdGFudGlhdGVkIFJ1biBTZXJ2aWNlLFxuICogICAgICAgICAgICAgICAvLyBzbyBhbnkgUnVuIFNlcnZpY2UgbWV0aG9kIGlzIHZhbGlkIGhlcmVcbiAqICAgICAgICAgICAgICAgdmFyIHJzID0gcm0ucnVuO1xuICogICAgICAgICAgICAgICBycy5kbygncnVuTW9kZWwnKTtcbiAqICAgICAgIH0pXG4gKlxuICovXG5cbid1c2Ugc3RyaWN0JztcblxudmFyIENvbmZpZ1NlcnZpY2UgPSByZXF1aXJlKCcuL2NvbmZpZ3VyYXRpb24tc2VydmljZScpO1xudmFyIFN0b3JhZ2VGYWN0b3J5ID0gcmVxdWlyZSgnLi4vc3RvcmUvc3RvcmUtZmFjdG9yeScpO1xudmFyIHF1dGlsID0gcmVxdWlyZSgnLi4vdXRpbC9xdWVyeS11dGlsJyk7XG52YXIgcnV0aWwgPSByZXF1aXJlKCcuLi91dGlsL3J1bi11dGlsJyk7XG52YXIgX3BpY2sgPSByZXF1aXJlKCcuLi91dGlsL29iamVjdC11dGlsJykuX3BpY2s7XG52YXIgVHJhbnNwb3J0RmFjdG9yeSA9IHJlcXVpcmUoJy4uL3RyYW5zcG9ydC9odHRwLXRyYW5zcG9ydC1mYWN0b3J5Jyk7XG52YXIgVmFyaWFibGVzU2VydmljZSA9IHJlcXVpcmUoJy4vdmFyaWFibGVzLWFwaS1zZXJ2aWNlJyk7XG5cbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24gKGNvbmZpZykge1xuICAgIC8vIGNvbmZpZyB8fCAoY29uZmlnID0gY29uZmlnU2VydmljZS5nZXQoKSk7XG4gICAgdmFyIHN0b3JlID0gbmV3IFN0b3JhZ2VGYWN0b3J5KHsgc3luY2hyb25vdXM6IHRydWUgfSk7XG5cbiAgICB2YXIgZGVmYXVsdHMgPSB7XG4gICAgICAgIC8qKlxuICAgICAgICAgKiBGb3IgcHJvamVjdHMgdGhhdCByZXF1aXJlIGF1dGhlbnRpY2F0aW9uLCBwYXNzIGluIHRoZSB1c2VyIGFjY2VzcyB0b2tlbiAoZGVmYXVsdHMgdG8gZW1wdHkgc3RyaW5nKS4gSWYgdGhlIHVzZXIgaXMgYWxyZWFkeSBsb2dnZWQgaW4gdG8gRXBpY2VudGVyLCB0aGUgdXNlciBhY2Nlc3MgdG9rZW4gaXMgYWxyZWFkeSBzZXQgaW4gYSBjb29raWUgYW5kIGF1dG9tYXRpY2FsbHkgbG9hZGVkIGZyb20gdGhlcmUuIChTZWUgW21vcmUgYmFja2dyb3VuZCBvbiBhY2Nlc3MgdG9rZW5zXSguLi8uLi8uLi9wcm9qZWN0X2FjY2Vzcy8pKS5cbiAgICAgICAgICogQHNlZSBbQXV0aGVudGljYXRpb24gQVBJIFNlcnZpY2VdKC4uL2F1dGgtYXBpLXNlcnZpY2UvKSBmb3IgZ2V0dGluZyB0b2tlbnMuXG4gICAgICAgICAqIEB0eXBlIHtTdHJpbmd9XG4gICAgICAgICAqL1xuICAgICAgICB0b2tlbjogc3RvcmUuZ2V0KCdlcGljZW50ZXIucHJvamVjdC50b2tlbicpIHx8ICcnLFxuXG4gICAgICAgIC8qKlxuICAgICAgICAgKiBUaGUgYWNjb3VudCBpZC4gSW4gdGhlIEVwaWNlbnRlciBVSSwgdGhpcyBpcyB0aGUgKipUZWFtIElEKiogKGZvciB0ZWFtIHByb2plY3RzKSBvciAqKlVzZXIgSUQqKiAoZm9yIHBlcnNvbmFsIHByb2plY3RzKS4gRGVmYXVsdHMgdG8gZW1wdHkgc3RyaW5nLlxuICAgICAgICAgKiBAdHlwZSB7U3RyaW5nfVxuICAgICAgICAgKi9cbiAgICAgICAgYWNjb3VudDogJycsXG5cbiAgICAgICAgLyoqXG4gICAgICAgICAqIFRoZSBwcm9qZWN0IGlkLiBEZWZhdWx0cyB0byBlbXB0eSBzdHJpbmcuXG4gICAgICAgICAqIEB0eXBlIHtTdHJpbmd9XG4gICAgICAgICAqL1xuICAgICAgICBwcm9qZWN0OiAnJyxcblxuICAgICAgICAvKipcbiAgICAgICAgICogQ3JpdGVyaWEgYnkgd2hpY2ggdG8gZmlsdGVyIHJ1bnMuIERlZmF1bHRzIHRvIGVtcHR5IHN0cmluZy5cbiAgICAgICAgICogQHR5cGUge1N0cmluZ31cbiAgICAgICAgICovXG4gICAgICAgIGZpbHRlcjogJycsXG5cbiAgICAgICAgLyoqXG4gICAgICAgICAqIENhbGxlZCB3aGVuIHRoZSBjYWxsIGNvbXBsZXRlcyBzdWNjZXNzZnVsbHkuIERlZmF1bHRzIHRvIGAkLm5vb3BgLlxuICAgICAgICAgKi9cbiAgICAgICAgc3VjY2VzczogJC5ub29wLFxuXG4gICAgICAgIC8qKlxuICAgICAgICAgKiBDYWxsZWQgd2hlbiB0aGUgY2FsbCBmYWlscy4gRGVmYXVsdHMgdG8gYCQubm9vcGAuXG4gICAgICAgICAqL1xuICAgICAgICBlcnJvcjogJC5ub29wLFxuXG4gICAgICAgIC8qKlxuICAgICAgICAgKiBPcHRpb25zIHRvIHBhc3Mgb24gdG8gdGhlIHVuZGVybHlpbmcgdHJhbnNwb3J0IGxheWVyLiBBbGwganF1ZXJ5LmFqYXggb3B0aW9ucyBhdCBodHRwOi8vYXBpLmpxdWVyeS5jb20valF1ZXJ5LmFqYXgvIGFyZSBhdmFpbGFibGUuIERlZmF1bHRzIHRvIGVtcHR5IG9iamVjdC5cbiAgICAgICAgICogQHR5cGUge09iamVjdH1cbiAgICAgICAgICovXG4gICAgICAgIHRyYW5zcG9ydDoge31cbiAgICB9O1xuXG4gICAgdmFyIHNlcnZpY2VPcHRpb25zID0gJC5leHRlbmQoe30sIGRlZmF1bHRzLCBjb25maWcpO1xuXG4gICAgdmFyIHVybENvbmZpZyA9IG5ldyBDb25maWdTZXJ2aWNlKHNlcnZpY2VPcHRpb25zKS5nZXQoJ3NlcnZlcicpO1xuICAgIGlmIChzZXJ2aWNlT3B0aW9ucy5hY2NvdW50KSB7XG4gICAgICAgIHVybENvbmZpZy5hY2NvdW50UGF0aCA9IHNlcnZpY2VPcHRpb25zLmFjY291bnQ7XG4gICAgfVxuICAgIGlmIChzZXJ2aWNlT3B0aW9ucy5wcm9qZWN0KSB7XG4gICAgICAgIHVybENvbmZpZy5wcm9qZWN0UGF0aCA9IHNlcnZpY2VPcHRpb25zLnByb2plY3Q7XG4gICAgfVxuXG4gICAgdXJsQ29uZmlnLmZpbHRlciA9ICc7JztcbiAgICB1cmxDb25maWcuZ2V0RmlsdGVyVVJMID0gZnVuY3Rpb24gKCkge1xuICAgICAgICB2YXIgdXJsID0gdXJsQ29uZmlnLmdldEFQSVBhdGgoJ3J1bicpO1xuICAgICAgICB2YXIgZmlsdGVyID0gcXV0aWwudG9NYXRyaXhGb3JtYXQoc2VydmljZU9wdGlvbnMuZmlsdGVyKTtcblxuICAgICAgICBpZiAoZmlsdGVyKSB7XG4gICAgICAgICAgICB1cmwgKz0gZmlsdGVyICsgJy8nO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiB1cmw7XG4gICAgfTtcblxuICAgIHZhciBodHRwT3B0aW9ucyA9ICQuZXh0ZW5kKHRydWUsIHt9LCBzZXJ2aWNlT3B0aW9ucy50cmFuc3BvcnQsIHtcbiAgICAgICAgdXJsOiB1cmxDb25maWcuZ2V0RmlsdGVyVVJMXG4gICAgfSk7XG5cbiAgICBpZiAoc2VydmljZU9wdGlvbnMudG9rZW4pIHtcbiAgICAgICAgaHR0cE9wdGlvbnMuaGVhZGVycyA9IHtcbiAgICAgICAgICAgICdBdXRob3JpemF0aW9uJzogJ0JlYXJlciAnICsgc2VydmljZU9wdGlvbnMudG9rZW5cbiAgICAgICAgfTtcbiAgICB9XG4gICAgdmFyIGh0dHAgPSBuZXcgVHJhbnNwb3J0RmFjdG9yeShodHRwT3B0aW9ucyk7XG5cbiAgICB2YXIgc2V0RmlsdGVyT3JUaHJvd0Vycm9yID0gZnVuY3Rpb24gKG9wdGlvbnMpIHtcbiAgICAgICAgaWYgKG9wdGlvbnMuZmlsdGVyKSB7XG4gICAgICAgICAgICBzZXJ2aWNlT3B0aW9ucy5maWx0ZXIgPSBvcHRpb25zLmZpbHRlcjtcbiAgICAgICAgfVxuICAgICAgICBpZiAoIXNlcnZpY2VPcHRpb25zLmZpbHRlcikge1xuICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdObyBmaWx0ZXIgc3BlY2lmaWVkIHRvIGFwcGx5IG9wZXJhdGlvbnMgYWdhaW5zdCcpO1xuICAgICAgICB9XG4gICAgfTtcblxuICAgIHZhciBwdWJsaWNBc3luY0FQSSA9IHtcbiAgICAgICAgdXJsQ29uZmlnOiB1cmxDb25maWcsXG5cbiAgICAgICAgLyoqXG4gICAgICAgICAqIENyZWF0ZSBhIG5ldyBydW4uXG4gICAgICAgICAqXG4gICAgICAgICAqIE5PVEU6IFR5cGljYWxseSB0aGlzIGlzIG5vdCB1c2VkISBVc2UgYFJ1bk1hbmFnZXIuZ2V0UnVuKClgIHdpdGggYSBgc3RyYXRlZ3lgIG9mIGBhbHdheXMtbmV3YCwgb3IgdXNlIGBSdW5NYW5hZ2VyLnJlc2V0KClgLiBTZWUgW1J1biBNYW5hZ2VyXSguLi9ydW4tbWFuYWdlci8pIGZvciBtb3JlIGRldGFpbHMuXG4gICAgICAgICAqXG4gICAgICAgICAqICAqKkV4YW1wbGUqKlxuICAgICAgICAgKlxuICAgICAgICAgKiAgICAgIHJzLmNyZWF0ZSgnaGVsbG9fd29ybGQuamwnKTtcbiAgICAgICAgICpcbiAgICAgICAgICogICoqUGFyYW1ldGVycyoqXG4gICAgICAgICAqIEBwYXJhbSB7U3RyaW5nfSBgbW9kZWxgIFRoZSBuYW1lIG9mIHRoZSBwcmltYXJ5IFttb2RlbCBmaWxlXSguLi8uLi8uLi93cml0aW5nX3lvdXJfbW9kZWwvKS4gVGhpcyBpcyB0aGUgb25lIGZpbGUgaW4gdGhlIHByb2plY3QgdGhhdCBleHBsaWNpdGx5IGV4cG9zZXMgdmFyaWFibGVzIGFuZCBtZXRob2RzLCBhbmQgaXQgbXVzdCBiZSBzdG9yZWQgaW4gdGhlIE1vZGVsIGZvbGRlciBvZiB5b3VyIEVwaWNlbnRlciBwcm9qZWN0LlxuICAgICAgICAgKiBAcGFyYW0ge09iamVjdH0gYG9wdGlvbnNgIChPcHRpb25hbCkgT3ZlcnJpZGVzIGZvciBjb25maWd1cmF0aW9uIG9wdGlvbnMuXG4gICAgICAgICAqXG4gICAgICAgICAqL1xuICAgICAgICBjcmVhdGU6IGZ1bmN0aW9uIChwYXJhbXMsIG9wdGlvbnMpIHtcbiAgICAgICAgICAgIHZhciBjcmVhdGVPcHRpb25zID0gJC5leHRlbmQodHJ1ZSwge30sIHNlcnZpY2VPcHRpb25zLCBvcHRpb25zLCB7IHVybDogdXJsQ29uZmlnLmdldEFQSVBhdGgoJ3J1bicpIH0pO1xuICAgICAgICAgICAgdmFyIHJ1bkFwaVBhcmFtcyA9IFsnbW9kZWwnLCAnc2NvcGUnLCAnZmlsZXMnXTtcbiAgICAgICAgICAgIGlmICh0eXBlb2YgcGFyYW1zID09PSAnc3RyaW5nJykge1xuICAgICAgICAgICAgICAgIC8vIHRoaXMgaXMganVzdCB0aGUgbW9kZWwgbmFtZVxuICAgICAgICAgICAgICAgIHBhcmFtcyA9IHsgbW9kZWw6IHBhcmFtcyB9O1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICAvLyB3aGl0ZWxpc3QgdGhlIGZpZWxkcyB0aGF0IHdlIGFjdHVhbGx5IGNhbiBzZW5kIHRvIHRoZSBhcGlcbiAgICAgICAgICAgICAgICBwYXJhbXMgPSBfcGljayhwYXJhbXMsIHJ1bkFwaVBhcmFtcyk7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIHZhciBvbGRTdWNjZXNzID0gY3JlYXRlT3B0aW9ucy5zdWNjZXNzO1xuICAgICAgICAgICAgY3JlYXRlT3B0aW9ucy5zdWNjZXNzID0gZnVuY3Rpb24gKHJlc3BvbnNlKSB7XG4gICAgICAgICAgICAgICAgc2VydmljZU9wdGlvbnMuZmlsdGVyID0gcmVzcG9uc2UuaWQ7IC8vYWxsIGZ1dHVyZSBjaGFpbmVkIGNhbGxzIHRvIG9wZXJhdGUgb24gdGhpcyBpZFxuICAgICAgICAgICAgICAgIHJldHVybiBvbGRTdWNjZXNzLmFwcGx5KHRoaXMsIGFyZ3VtZW50cyk7XG4gICAgICAgICAgICB9O1xuXG4gICAgICAgICAgICByZXR1cm4gaHR0cC5wb3N0KHBhcmFtcywgY3JlYXRlT3B0aW9ucyk7XG4gICAgICAgIH0sXG5cbiAgICAgICAgLyoqXG4gICAgICAgICAqIFJldHVybnMgcGFydGljdWxhciBydW5zLCBiYXNlZCBvbiBjb25kaXRpb25zIHNwZWNpZmllZCBpbiB0aGUgYHFzYCBvYmplY3QuXG4gICAgICAgICAqXG4gICAgICAgICAqIFRoZSBlbGVtZW50cyBvZiB0aGUgYHFzYCBvYmplY3QgYXJlIEFORGVkIHRvZ2V0aGVyIHdpdGhpbiBhIHNpbmdsZSBjYWxsIHRvIGAucXVlcnkoKWAuXG4gICAgICAgICAqXG4gICAgICAgICAqICoqRXhhbXBsZSoqXG4gICAgICAgICAqXG4gICAgICAgICAqICAgICAgLy8gcmV0dXJucyBydW5zIHdpdGggc2F2ZWQgPSB0cnVlIGFuZCB2YXJpYWJsZXMucHJpY2UgPiAxLFxuICAgICAgICAgKiAgICAgIC8vIHdoZXJlIHZhcmlhYmxlcy5wcmljZSBoYXMgYmVlbiBwZXJzaXN0ZWQgKHJlY29yZGVkKVxuICAgICAgICAgKiAgICAgIC8vIGluIHRoZSBtb2RlbC5cbiAgICAgICAgICogICAgIHJzLnF1ZXJ5KHtcbiAgICAgICAgICogICAgICAgICAgJ3NhdmVkJzogJ3RydWUnLFxuICAgICAgICAgKiAgICAgICAgICAnLnByaWNlJzogJz4xJ1xuICAgICAgICAgKiAgICAgICB9LFxuICAgICAgICAgKiAgICAgICB7XG4gICAgICAgICAqICAgICAgICAgIHN0YXJ0cmVjb3JkOiAyLFxuICAgICAgICAgKiAgICAgICAgICBlbmRyZWNvcmQ6IDVcbiAgICAgICAgICogICAgICAgfSk7XG4gICAgICAgICAqXG4gICAgICAgICAqICoqUGFyYW1ldGVycyoqXG4gICAgICAgICAqIEBwYXJhbSB7T2JqZWN0fSBgcXNgIFF1ZXJ5IG9iamVjdC4gRWFjaCBrZXkgY2FuIGJlIGEgcHJvcGVydHkgb2YgdGhlIHJ1biBvciB0aGUgbmFtZSBvZiB2YXJpYWJsZSB0aGF0IGhhcyBiZWVuIHNhdmVkIGluIHRoZSBydW4gKHByZWZhY2VkIGJ5IGB2YXJpYWJsZXMuYCkuIEVhY2ggdmFsdWUgY2FuIGJlIGEgbGl0ZXJhbCB2YWx1ZSwgb3IgYSBjb21wYXJpc29uIG9wZXJhdG9yIGFuZCB2YWx1ZS4gKFNlZSBbbW9yZSBvbiBmaWx0ZXJpbmddKC4uLy4uLy4uL3Jlc3RfYXBpcy9hZ2dyZWdhdGVfcnVuX2FwaS8jZmlsdGVycykgYWxsb3dlZCBpbiB0aGUgdW5kZXJseWluZyBSdW4gQVBJLikgUXVlcnlpbmcgZm9yIHZhcmlhYmxlcyBpcyBhdmFpbGFibGUgZm9yIHJ1bnMgW2luIG1lbW9yeV0oLi4vLi4vLi4vcnVuX3BlcnNpc3RlbmNlLyNydW5zLWluLW1lbW9yeSkgYW5kIGZvciBydW5zIFtpbiB0aGUgZGF0YWJhc2VdKC4uLy4uLy4uL3J1bl9wZXJzaXN0ZW5jZS8jcnVucy1pbi1tZW1vcnkpIGlmIHRoZSB2YXJpYWJsZXMgYXJlIHBlcnNpc3RlZCAoZS5nLiB0aGF0IGhhdmUgYmVlbiBgcmVjb3JkYGVkIGluIHlvdXIgSnVsaWEgbW9kZWwpLlxuICAgICAgICAgKiBAcGFyYW0ge09iamVjdH0gYG91dHB1dE1vZGlmaWVyYCAoT3B0aW9uYWwpIEF2YWlsYWJsZSBmaWVsZHMgaW5jbHVkZTogYHN0YXJ0cmVjb3JkYCwgYGVuZHJlY29yZGAsIGBzb3J0YCwgYW5kIGBkaXJlY3Rpb25gIChgYXNjYCBvciBgZGVzY2ApLlxuICAgICAgICAgKiBAcGFyYW0ge09iamVjdH0gYG9wdGlvbnNgIChPcHRpb25hbCkgT3ZlcnJpZGVzIGZvciBjb25maWd1cmF0aW9uIG9wdGlvbnMuXG4gICAgICAgICAqL1xuICAgICAgICBxdWVyeTogZnVuY3Rpb24gKHFzLCBvdXRwdXRNb2RpZmllciwgb3B0aW9ucykge1xuICAgICAgICAgICAgc2VydmljZU9wdGlvbnMuZmlsdGVyID0gcXM7IC8vc2hvdWxkbid0IGJlIGFibGUgdG8gb3Zlci1yaWRlXG4gICAgICAgICAgICB2YXIgaHR0cE9wdGlvbnMgPSAkLmV4dGVuZCh0cnVlLCB7fSwgc2VydmljZU9wdGlvbnMsIG9wdGlvbnMpO1xuICAgICAgICAgICAgcmV0dXJuIGh0dHAuZ2V0KG91dHB1dE1vZGlmaWVyLCBodHRwT3B0aW9ucyk7XG4gICAgICAgIH0sXG5cbiAgICAgICAgLyoqXG4gICAgICAgICAqIFJldHVybnMgcGFydGljdWxhciBydW5zLCBiYXNlZCBvbiBjb25kaXRpb25zIHNwZWNpZmllZCBpbiB0aGUgYHFzYCBvYmplY3QuXG4gICAgICAgICAqXG4gICAgICAgICAqIFNpbWlsYXIgdG8gYC5xdWVyeSgpYC5cbiAgICAgICAgICpcbiAgICAgICAgICogKipQYXJhbWV0ZXJzKipcbiAgICAgICAgICogQHBhcmFtIHtPYmplY3R9IGBmaWx0ZXJgIEZpbHRlciBvYmplY3QuIEVhY2gga2V5IGNhbiBiZSBhIHByb3BlcnR5IG9mIHRoZSBydW4gb3IgdGhlIG5hbWUgb2YgdmFyaWFibGUgdGhhdCBoYXMgYmVlbiBzYXZlZCBpbiB0aGUgcnVuIChwcmVmYWNlZCBieSBgdmFyaWFibGVzLmApLiBFYWNoIHZhbHVlIGNhbiBiZSBhIGxpdGVyYWwgdmFsdWUsIG9yIGEgY29tcGFyaXNvbiBvcGVyYXRvciBhbmQgdmFsdWUuIChTZWUgW21vcmUgb24gZmlsdGVyaW5nXSguLi8uLi8uLi9yZXN0X2FwaXMvYWdncmVnYXRlX3J1bl9hcGkvI2ZpbHRlcnMpIGFsbG93ZWQgaW4gdGhlIHVuZGVybHlpbmcgUnVuIEFQSS4pIEZpbHRlcmluZyBmb3IgdmFyaWFibGVzIGlzIGF2YWlsYWJsZSBmb3IgcnVucyBbaW4gbWVtb3J5XSguLi8uLi8uLi9ydW5fcGVyc2lzdGVuY2UvI3J1bnMtaW4tbWVtb3J5KSBhbmQgZm9yIHJ1bnMgW2luIHRoZSBkYXRhYmFzZV0oLi4vLi4vLi4vcnVuX3BlcnNpc3RlbmNlLyNydW5zLWluLW1lbW9yeSkgaWYgdGhlIHZhcmlhYmxlcyBhcmUgcGVyc2lzdGVkIChlLmcuIHRoYXQgaGF2ZSBiZWVuIGByZWNvcmRgZWQgaW4geW91ciBKdWxpYSBtb2RlbCkuXG4gICAgICAgICAqIEBwYXJhbSB7T2JqZWN0fSBgb3V0cHV0TW9kaWZpZXJgIChPcHRpb25hbCkgQXZhaWxhYmxlIGZpZWxkcyBpbmNsdWRlOiBgc3RhcnRyZWNvcmRgLCBgZW5kcmVjb3JkYCwgYHNvcnRgLCBhbmQgYGRpcmVjdGlvbmAgKGBhc2NgIG9yIGBkZXNjYCkuXG4gICAgICAgICAqIEBwYXJhbSB7T2JqZWN0fSBgb3B0aW9uc2AgKE9wdGlvbmFsKSBPdmVycmlkZXMgZm9yIGNvbmZpZ3VyYXRpb24gb3B0aW9ucy5cbiAgICAgICAgICovXG4gICAgICAgIGZpbHRlcjogZnVuY3Rpb24gKGZpbHRlciwgb3V0cHV0TW9kaWZpZXIsIG9wdGlvbnMpIHtcbiAgICAgICAgICAgIGlmICgkLmlzUGxhaW5PYmplY3Qoc2VydmljZU9wdGlvbnMuZmlsdGVyKSkge1xuICAgICAgICAgICAgICAgICQuZXh0ZW5kKHNlcnZpY2VPcHRpb25zLmZpbHRlciwgZmlsdGVyKTtcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgc2VydmljZU9wdGlvbnMuZmlsdGVyID0gZmlsdGVyO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgdmFyIGh0dHBPcHRpb25zID0gJC5leHRlbmQodHJ1ZSwge30sIHNlcnZpY2VPcHRpb25zLCBvcHRpb25zKTtcbiAgICAgICAgICAgIHJldHVybiBodHRwLmdldChvdXRwdXRNb2RpZmllciwgaHR0cE9wdGlvbnMpO1xuICAgICAgICB9LFxuXG4gICAgICAgIC8qKlxuICAgICAgICAgKiBHZXQgZGF0YSBmb3IgYSBzcGVjaWZpYyBydW4uIFRoaXMgaW5jbHVkZXMgc3RhbmRhcmQgcnVuIGRhdGEgc3VjaCBhcyB0aGUgYWNjb3VudCwgbW9kZWwsIHByb2plY3QsIGFuZCBjcmVhdGVkIGFuZCBsYXN0IG1vZGlmaWVkIGRhdGVzLiBUbyByZXF1ZXN0IHNwZWNpZmljIG1vZGVsIHZhcmlhYmxlcywgcGFzcyB0aGVtIGFzIHBhcnQgb2YgdGhlIGBmaWx0ZXJzYCBwYXJhbWV0ZXIuXG4gICAgICAgICAqXG4gICAgICAgICAqIE5vdGUgdGhhdCBpZiB0aGUgcnVuIGlzIFtpbiBtZW1vcnldKC4uLy4uLy4uL3J1bl9wZXJzaXN0ZW5jZS8jcnVucy1pbi1tZW1vcnkpLCBhbnkgbW9kZWwgdmFyaWFibGVzIGFyZSBhdmFpbGFibGU7IGlmIHRoZSBydW4gaXMgW2luIHRoZSBkYXRhYmFzZV0oLi4vLi4vLi4vcnVuX3BlcnNpc3RlbmNlLyNydW5zLWluLWRiKSwgb25seSBtb2RlbCB2YXJpYWJsZXMgdGhhdCBoYXZlIGJlZW4gcGVyc2lzdGVkICZtZGFzaDsgdGhhdCBpcywgYHJlY29yZGBlZCBpbiB5b3VyIEp1bGlhIG1vZGVsICZtZGFzaDsgYXJlIGF2YWlsYWJsZS5cbiAgICAgICAgICpcbiAgICAgICAgICogKipFeGFtcGxlKipcbiAgICAgICAgICpcbiAgICAgICAgICogICAgIHJzLmxvYWQoJ2JiNTg5Njc3LWQ0NzYtNDk3MS1hNjhlLTBjNThkMTkxZTQ1MCcsIHsgaW5jbHVkZTogWycucHJpY2UnLCAnLnNhbGVzJ10gfSk7XG4gICAgICAgICAqXG4gICAgICAgICAqICoqUGFyYW1ldGVycyoqXG4gICAgICAgICAqIEBwYXJhbSB7U3RyaW5nfSBgcnVuSURgIFRoZSBydW4gaWQuXG4gICAgICAgICAqIEBwYXJhbSB7T2JqZWN0fSBgZmlsdGVyc2AgKE9wdGlvbmFsKSBPYmplY3QgY29udGFpbmluZyBmaWx0ZXJzIGFuZCBvcGVyYXRpb24gbW9kaWZpZXJzLiBVc2Uga2V5IGBpbmNsdWRlYCB0byBsaXN0IG1vZGVsIHZhcmlhYmxlcyB0aGF0IHlvdSB3YW50IHRvIGluY2x1ZGUgaW4gdGhlIHJlc3BvbnNlLiBPdGhlciBhdmFpbGFibGUgZmllbGRzIGluY2x1ZGU6IGBzdGFydHJlY29yZGAsIGBlbmRyZWNvcmRgLCBgc29ydGAsIGFuZCBgZGlyZWN0aW9uYCAoYGFzY2Agb3IgYGRlc2NgKS5cbiAgICAgICAgICogQHBhcmFtIHtPYmplY3R9IGBvcHRpb25zYCAoT3B0aW9uYWwpIE92ZXJyaWRlcyBmb3IgY29uZmlndXJhdGlvbiBvcHRpb25zLlxuICAgICAgICAgKi9cbiAgICAgICAgbG9hZDogZnVuY3Rpb24gKHJ1bklELCBmaWx0ZXJzLCBvcHRpb25zKSB7XG4gICAgICAgICAgICBzZXJ2aWNlT3B0aW9ucy5maWx0ZXIgPSBydW5JRDsgLy9zaG91bGRuJ3QgYmUgYWJsZSB0byBvdmVyLXJpZGVcbiAgICAgICAgICAgIHZhciBodHRwT3B0aW9ucyA9ICQuZXh0ZW5kKHRydWUsIHt9LCBzZXJ2aWNlT3B0aW9ucywgb3B0aW9ucyk7XG4gICAgICAgICAgICByZXR1cm4gaHR0cC5nZXQoZmlsdGVycywgaHR0cE9wdGlvbnMpO1xuICAgICAgICB9LFxuXG5cbiAgICAgICAgLy9TYXZpbmcgZGF0YVxuICAgICAgICAvKipcbiAgICAgICAgICogU2F2ZSBhdHRyaWJ1dGVzIChkYXRhLCBtb2RlbCB2YXJpYWJsZXMpIG9mIHRoZSBydW4uXG4gICAgICAgICAqXG4gICAgICAgICAqICoqRXhhbXBsZXMqKlxuICAgICAgICAgKlxuICAgICAgICAgKiAgICAgcnMuc2F2ZSh7IGNvbXBsZXRlZDogdHJ1ZSB9KTtcbiAgICAgICAgICogICAgIHJzLnNhdmUoeyBzYXZlZDogdHJ1ZSwgdmFyaWFibGVzOiB7IGE6IDIzLCBiOiAyMyB9IH0pO1xuICAgICAgICAgKlxuICAgICAgICAgKiAqKlBhcmFtZXRlcnMqKlxuICAgICAgICAgKiBAcGFyYW0ge09iamVjdH0gYGF0dHJpYnV0ZXNgIFRoZSBydW4gZGF0YSBhbmQgdmFyaWFibGVzIHRvIHNhdmUuIE1vZGVsIHZhcmlhYmxlcyBtdXN0IGJlIGluY2x1ZGVkIGluIGEgYHZhcmlhYmxlc2AgZmllbGQgd2l0aGluIHRoZSBgYXR0cmlidXRlc2Agb2JqZWN0IChvdGhlcndpc2UgdGhleSBhcmUgdHJlYXRlZCBhcyBydW4gZGF0YSBhbmQgYWRkZWQgdG8gdGhlIHJ1biByZWNvcmQgZGlyZWN0bHkpLlxuICAgICAgICAgKiBAcGFyYW0ge09iamVjdH0gYG9wdGlvbnNgIChPcHRpb25hbCkgT3ZlcnJpZGVzIGZvciBjb25maWd1cmF0aW9uIG9wdGlvbnMuXG4gICAgICAgICAqL1xuICAgICAgICBzYXZlOiBmdW5jdGlvbiAoYXR0cmlidXRlcywgb3B0aW9ucykge1xuICAgICAgICAgICAgdmFyIGh0dHBPcHRpb25zID0gJC5leHRlbmQodHJ1ZSwge30sIHNlcnZpY2VPcHRpb25zLCBvcHRpb25zKTtcbiAgICAgICAgICAgIHNldEZpbHRlck9yVGhyb3dFcnJvcihodHRwT3B0aW9ucyk7XG4gICAgICAgICAgICByZXR1cm4gaHR0cC5wYXRjaChhdHRyaWJ1dGVzLCBodHRwT3B0aW9ucyk7XG4gICAgICAgIH0sXG5cbiAgICAgICAgLy8jI09wZXJhdGlvbnNcbiAgICAgICAgLyoqXG4gICAgICAgICAqIENhbGwgYSBtZXRob2QgZnJvbSB0aGUgbW9kZWwuXG4gICAgICAgICAqXG4gICAgICAgICAqIERlcGVuZGluZyBvbiB0aGUgbGFuZ3VhZ2UgaW4gd2hpY2ggeW91IGhhdmUgd3JpdHRlbiB5b3VyIG1vZGVsLCB0aGUgbWV0aG9kIG1heSBuZWVkIHRvIGJlIGV4cG9zZWQgKGUuZy4gYGV4cG9ydGAgZm9yIGEgSnVsaWEgbW9kZWwpIGluIHRoZSBtb2RlbCBmaWxlIGluIG9yZGVyIHRvIGJlIGNhbGxlZCB0aHJvdWdoIHRoZSBBUEkuIFNlZSBbV3JpdGluZyB5b3VyIE1vZGVsXSguLi8uLi8uLi93cml0aW5nX3lvdXJfbW9kZWwvKSkuXG4gICAgICAgICAqXG4gICAgICAgICAqIFRoZSBgcGFyYW1zYCBhcmd1bWVudCBpcyBub3JtYWxseSBhbiBhcnJheSBvZiBhcmd1bWVudHMgdG8gdGhlIGBvcGVyYXRpb25gLiBJbiB0aGUgc3BlY2lhbCBjYXNlIHdoZXJlIGBvcGVyYXRpb25gIG9ubHkgdGFrZXMgb25lIGFyZ3VtZW50LCB5b3UgYXJlIG5vdCByZXF1aXJlZCB0byBwdXQgdGhhdCBhcmd1bWVudCBpbnRvIGFuIGFycmF5LlxuICAgICAgICAgKlxuICAgICAgICAgKiBOb3RlIHRoYXQgeW91IGNhbiBjb21iaW5lIHRoZSBgb3BlcmF0aW9uYCBhbmQgYHBhcmFtc2AgYXJndW1lbnRzIGludG8gYSBzaW5nbGUgb2JqZWN0IGlmIHlvdSBwcmVmZXIsIGFzIGluIHRoZSBsYXN0IGV4YW1wbGUuXG4gICAgICAgICAqXG4gICAgICAgICAqICoqRXhhbXBsZXMqKlxuICAgICAgICAgKlxuICAgICAgICAgKiAgICAgIC8vIG1ldGhvZCBcInNvbHZlXCIgdGFrZXMgbm8gYXJndW1lbnRzXG4gICAgICAgICAqICAgICBycy5kbygnc29sdmUnKTtcbiAgICAgICAgICogICAgICAvLyBtZXRob2QgXCJlY2hvXCIgdGFrZXMgb25lIGFyZ3VtZW50LCBhIHN0cmluZ1xuICAgICAgICAgKiAgICAgcnMuZG8oJ2VjaG8nLCBbJ2hlbGxvJ10pO1xuICAgICAgICAgKiAgICAgIC8vIG1ldGhvZCBcImVjaG9cIiB0YWtlcyBvbmUgYXJndW1lbnQsIGEgc3RyaW5nXG4gICAgICAgICAqICAgICBycy5kbygnZWNobycsICdoZWxsbycpO1xuICAgICAgICAgKiAgICAgIC8vIG1ldGhvZCBcInN1bUFycmF5XCIgdGFrZXMgb25lIGFyZ3VtZW50LCBhbiBhcnJheVxuICAgICAgICAgKiAgICAgcnMuZG8oJ3N1bUFycmF5JywgW1s0LDIsMV1dKTtcbiAgICAgICAgICogICAgICAvLyBtZXRob2QgXCJhZGRcIiB0YWtlcyB0d28gYXJndW1lbnRzLCBib3RoIGludGVnZXJzXG4gICAgICAgICAqICAgICBycy5kbyh7IG5hbWU6J2FkZCcsIHBhcmFtczpbMiw0XSB9KTtcbiAgICAgICAgICpcbiAgICAgICAgICogKipQYXJhbWV0ZXJzKipcbiAgICAgICAgICogQHBhcmFtIHtTdHJpbmd9IGBvcGVyYXRpb25gIE5hbWUgb2YgbWV0aG9kLlxuICAgICAgICAgKiBAcGFyYW0ge0FycmF5fSBgcGFyYW1zYCAoT3B0aW9uYWwpIEFueSBwYXJhbWV0ZXJzIHRoZSBvcGVyYXRpb24gdGFrZXMsIHBhc3NlZCBhcyBhbiBhcnJheS4gSW4gdGhlIHNwZWNpYWwgY2FzZSB3aGVyZSBgb3BlcmF0aW9uYCBvbmx5IHRha2VzIG9uZSBhcmd1bWVudCwgeW91IGFyZSBub3QgcmVxdWlyZWQgdG8gcHV0IHRoYXQgYXJndW1lbnQgaW50byBhbiBhcnJheSwgYW5kIGNhbiBqdXN0IHBhc3MgaXQgZGlyZWN0bHkuXG4gICAgICAgICAqIEBwYXJhbSB7T2JqZWN0fSBgb3B0aW9uc2AgKE9wdGlvbmFsKSBPdmVycmlkZXMgZm9yIGNvbmZpZ3VyYXRpb24gb3B0aW9ucy5cbiAgICAgICAgICovXG4gICAgICAgIGRvOiBmdW5jdGlvbiAob3BlcmF0aW9uLCBwYXJhbXMsIG9wdGlvbnMpIHtcbiAgICAgICAgICAgIC8vIGNvbnNvbGUubG9nKCdkbycsIG9wZXJhdGlvbiwgcGFyYW1zKTtcbiAgICAgICAgICAgIHZhciBvcHNBcmdzO1xuICAgICAgICAgICAgdmFyIHBvc3RPcHRpb25zO1xuICAgICAgICAgICAgaWYgKG9wdGlvbnMpIHtcbiAgICAgICAgICAgICAgICBvcHNBcmdzID0gcGFyYW1zO1xuICAgICAgICAgICAgICAgIHBvc3RPcHRpb25zID0gb3B0aW9ucztcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgaWYgKCQuaXNQbGFpbk9iamVjdChwYXJhbXMpKSB7XG4gICAgICAgICAgICAgICAgICAgIG9wc0FyZ3MgPSBudWxsO1xuICAgICAgICAgICAgICAgICAgICBwb3N0T3B0aW9ucyA9IHBhcmFtcztcbiAgICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICBvcHNBcmdzID0gcGFyYW1zO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHZhciByZXN1bHQgPSBydXRpbC5ub3JtYWxpemVPcGVyYXRpb25zKG9wZXJhdGlvbiwgb3BzQXJncyk7XG4gICAgICAgICAgICB2YXIgaHR0cE9wdGlvbnMgPSAkLmV4dGVuZCh0cnVlLCB7fSwgc2VydmljZU9wdGlvbnMsIHBvc3RPcHRpb25zKTtcblxuICAgICAgICAgICAgc2V0RmlsdGVyT3JUaHJvd0Vycm9yKGh0dHBPcHRpb25zKTtcblxuICAgICAgICAgICAgdmFyIHBybXMgPSAocmVzdWx0LmFyZ3NbMF0ubGVuZ3RoICYmIChyZXN1bHQuYXJnc1swXSAhPT0gbnVsbCAmJiByZXN1bHQuYXJnc1swXSAhPT0gdW5kZWZpbmVkKSkgPyByZXN1bHQuYXJnc1swXSA6IFtdO1xuICAgICAgICAgICAgcmV0dXJuIGh0dHAucG9zdCh7IGFyZ3VtZW50czogcHJtcyB9LCAkLmV4dGVuZCh0cnVlLCB7fSwgaHR0cE9wdGlvbnMsIHtcbiAgICAgICAgICAgICAgICB1cmw6IHVybENvbmZpZy5nZXRGaWx0ZXJVUkwoKSArICdvcGVyYXRpb25zLycgKyByZXN1bHQub3BzWzBdICsgJy8nXG4gICAgICAgICAgICB9KSk7XG4gICAgICAgIH0sXG5cbiAgICAgICAgLyoqXG4gICAgICAgICAqIENhbGwgc2V2ZXJhbCBtZXRob2RzIGZyb20gdGhlIG1vZGVsLCBzZXF1ZW50aWFsbHkuXG4gICAgICAgICAqXG4gICAgICAgICAqIERlcGVuZGluZyBvbiB0aGUgbGFuZ3VhZ2UgaW4gd2hpY2ggeW91IGhhdmUgd3JpdHRlbiB5b3VyIG1vZGVsLCB0aGUgbWV0aG9kcyBtYXkgbmVlZCB0byBiZSBleHBvc2VkIChlLmcuIGBleHBvcnRgIGZvciBhIEp1bGlhIG1vZGVsKSBpbiB0aGUgbW9kZWwgZmlsZSBpbiBvcmRlciB0byBiZSBjYWxsZWQgdGhyb3VnaCB0aGUgQVBJLiBTZWUgW1dyaXRpbmcgeW91ciBNb2RlbF0oLi4vLi4vLi4vd3JpdGluZ195b3VyX21vZGVsLykpLlxuICAgICAgICAgKlxuICAgICAgICAgKiAqKkV4YW1wbGVzKipcbiAgICAgICAgICpcbiAgICAgICAgICogICAgICAvLyBtZXRob2RzIFwiaW5pdGlhbGl6ZVwiIGFuZCBcInNvbHZlXCIgZG8gbm90IHRha2UgYW55IGFyZ3VtZW50c1xuICAgICAgICAgKiAgICAgcnMuc2VyaWFsKFsnaW5pdGlhbGl6ZScsICdzb2x2ZSddKTtcbiAgICAgICAgICogICAgICAvLyBtZXRob2RzIFwiaW5pdFwiIGFuZCBcInJlc2V0XCIgdGFrZSB0d28gYXJndW1lbnRzIGVhY2hcbiAgICAgICAgICogICAgIHJzLnNlcmlhbChbICB7IG5hbWU6ICdpbml0JywgcGFyYW1zOiBbMSwyXSB9LFxuICAgICAgICAgKiAgICAgICAgICAgICAgICAgIHsgbmFtZTogJ3Jlc2V0JywgcGFyYW1zOiBbMiwzXSB9XSk7XG4gICAgICAgICAqICAgICAgLy8gbWV0aG9kIFwiaW5pdFwiIHRha2VzIHR3byBhcmd1bWVudHMsXG4gICAgICAgICAqICAgICAgLy8gbWV0aG9kIFwicnVubW9kZWxcIiB0YWtlcyBub25lXG4gICAgICAgICAqICAgICBycy5zZXJpYWwoWyAgeyBuYW1lOiAnaW5pdCcsIHBhcmFtczogWzEsMl0gfSxcbiAgICAgICAgICogICAgICAgICAgICAgICAgICB7IG5hbWU6ICdydW5tb2RlbCcsIHBhcmFtczogW10gfV0pO1xuICAgICAgICAgKlxuICAgICAgICAgKiAqKlBhcmFtZXRlcnMqKlxuICAgICAgICAgKiBAcGFyYW0ge0FycmF5W1N0cmluZ118QXJyYXlbT2JqZWN0XX0gYG9wZXJhdGlvbnNgIElmIG5vbmUgb2YgdGhlIG1ldGhvZHMgdGFrZSBwYXJhbWV0ZXJzLCBwYXNzIGFuIGFycmF5IG9mIHRoZSBtZXRob2QgbmFtZXMgKHN0cmluZ3MpLiBJZiBhbnkgb2YgdGhlIG1ldGhvZHMgZG8gdGFrZSBwYXJhbWV0ZXJzLCBwYXNzIGFuIGFycmF5IG9mIG9iamVjdHMsIGVhY2ggb2Ygd2hpY2ggY29udGFpbnMgYSBtZXRob2QgbmFtZSBhbmQgaXRzIG93biAocG9zc2libHkgZW1wdHkpIGFycmF5IG9mIHBhcmFtZXRlcnMuXG4gICAgICAgICAqIEBwYXJhbSB7T2JqZWN0fSBgb3B0aW9uc2AgKE9wdGlvbmFsKSBPdmVycmlkZXMgZm9yIGNvbmZpZ3VyYXRpb24gb3B0aW9ucy5cbiAgICAgICAgICovXG4gICAgICAgIHNlcmlhbDogZnVuY3Rpb24gKG9wZXJhdGlvbnMsIHBhcmFtcywgb3B0aW9ucykge1xuICAgICAgICAgICAgdmFyIG9wUGFyYW1zID0gcnV0aWwubm9ybWFsaXplT3BlcmF0aW9ucyhvcGVyYXRpb25zLCBwYXJhbXMpO1xuICAgICAgICAgICAgdmFyIG9wcyA9IG9wUGFyYW1zLm9wcztcbiAgICAgICAgICAgIHZhciBhcmdzID0gb3BQYXJhbXMuYXJncztcbiAgICAgICAgICAgIHZhciBtZSA9IHRoaXM7XG5cbiAgICAgICAgICAgIHZhciAkZCA9ICQuRGVmZXJyZWQoKTtcbiAgICAgICAgICAgIHZhciBwb3N0T3B0aW9ucyA9ICQuZXh0ZW5kKHRydWUsIHt9LCBzZXJ2aWNlT3B0aW9ucywgb3B0aW9ucyk7XG5cbiAgICAgICAgICAgIHZhciBkb1NpbmdsZU9wID0gZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgICAgIHZhciBvcCA9IG9wcy5zaGlmdCgpO1xuICAgICAgICAgICAgICAgIHZhciBhcmcgPSBhcmdzLnNoaWZ0KCk7XG5cbiAgICAgICAgICAgICAgICBtZS5kbyhvcCwgYXJnLCB7XG4gICAgICAgICAgICAgICAgICAgIHN1Y2Nlc3M6IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIGlmIChvcHMubGVuZ3RoKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgZG9TaW5nbGVPcCgpO1xuICAgICAgICAgICAgICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAkZC5yZXNvbHZlLmFwcGx5KHRoaXMsIGFyZ3VtZW50cyk7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgcG9zdE9wdGlvbnMuc3VjY2Vzcy5hcHBseSh0aGlzLCBhcmd1bWVudHMpO1xuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgICAgICBlcnJvcjogZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgICAgICAgICAgICAgJGQucmVqZWN0LmFwcGx5KHRoaXMsIGFyZ3VtZW50cyk7XG4gICAgICAgICAgICAgICAgICAgICAgICBwb3N0T3B0aW9ucy5lcnJvci5hcHBseSh0aGlzLCBhcmd1bWVudHMpO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICB9O1xuXG4gICAgICAgICAgICBkb1NpbmdsZU9wKCk7XG5cbiAgICAgICAgICAgIHJldHVybiAkZC5wcm9taXNlKCk7XG4gICAgICAgIH0sXG5cbiAgICAgICAgLyoqXG4gICAgICAgICAqIENhbGwgc2V2ZXJhbCBtZXRob2RzIGZyb20gdGhlIG1vZGVsLCBleGVjdXRpbmcgdGhlbSBpbiBwYXJhbGxlbC5cbiAgICAgICAgICpcbiAgICAgICAgICogRGVwZW5kaW5nIG9uIHRoZSBsYW5ndWFnZSBpbiB3aGljaCB5b3UgaGF2ZSB3cml0dGVuIHlvdXIgbW9kZWwsIHRoZSBtZXRob2RzIG1heSBuZWVkIHRvIGJlIGV4cG9zZWQgKGUuZy4gYGV4cG9ydGAgZm9yIGEgSnVsaWEgbW9kZWwpIGluIHRoZSBtb2RlbCBmaWxlIGluIG9yZGVyIHRvIGJlIGNhbGxlZCB0aHJvdWdoIHRoZSBBUEkuIFNlZSBbV3JpdGluZyB5b3VyIE1vZGVsXSguLi8uLi8uLi93cml0aW5nX3lvdXJfbW9kZWwvKSkuXG4gICAgICAgICAqXG4gICAgICAgICAqICoqRXhhbXBsZSoqXG4gICAgICAgICAqXG4gICAgICAgICAqICAgICAgLy8gbWV0aG9kcyBcInNvbHZlXCIgYW5kIFwicmVzZXRcIiBkbyBub3QgdGFrZSBhbnkgYXJndW1lbnRzXG4gICAgICAgICAqICAgICBycy5wYXJhbGxlbChbJ3NvbHZlJywgJ3Jlc2V0J10pO1xuICAgICAgICAgKiAgICAgIC8vIG1ldGhvZHMgXCJhZGRcIiBhbmQgXCJzdWJ0cmFjdFwiIHRha2UgdHdvIGFyZ3VtZW50cyBlYWNoXG4gICAgICAgICAqICAgICBycy5wYXJhbGxlbChbIHsgbmFtZTogJ2FkZCcsIHBhcmFtczogWzEsMl0gfSxcbiAgICAgICAgICogICAgICAgICAgICAgICAgICAgeyBuYW1lOiAnc3VidHJhY3QnLCBwYXJhbXM6WzIsM10gfV0pO1xuICAgICAgICAgKiAgICAgIC8vIG1ldGhvZHMgXCJhZGRcIiBhbmQgXCJzdWJ0cmFjdFwiIHRha2UgdHdvIGFyZ3VtZW50cyBlYWNoXG4gICAgICAgICAqICAgICBycy5wYXJhbGxlbCh7IGFkZDogWzEsMl0sIHN1YnRyYWN0OiBbMiw0XSB9KTtcbiAgICAgICAgICpcbiAgICAgICAgICogKipQYXJhbWV0ZXJzKipcbiAgICAgICAgICogQHBhcmFtIHtBcnJheXxPYmplY3R9IGBvcGVyYXRpb25zYCBJZiBub25lIG9mIHRoZSBtZXRob2RzIHRha2UgcGFyYW1ldGVycywgcGFzcyBhbiBhcnJheSBvZiB0aGUgbWV0aG9kIG5hbWVzIChhcyBzdHJpbmdzKS4gSWYgYW55IG9mIHRoZSBtZXRob2RzIGRvIHRha2UgcGFyYW1ldGVycywgeW91IGhhdmUgdHdvIG9wdGlvbnMuIFlvdSBjYW4gcGFzcyBhbiBhcnJheSBvZiBvYmplY3RzLCBlYWNoIG9mIHdoaWNoIGNvbnRhaW5zIGEgbWV0aG9kIG5hbWUgYW5kIGl0cyBvd24gKHBvc3NpYmx5IGVtcHR5KSBhcnJheSBvZiBwYXJhbWV0ZXJzLiBBbHRlcm5hdGl2ZWx5LCB5b3UgY2FuIHBhc3MgYSBzaW5nbGUgb2JqZWN0IHdpdGggdGhlIG1ldGhvZCBuYW1lIGFuZCBhIChwb3NzaWJseSBlbXB0eSkgYXJyYXkgb2YgcGFyYW1ldGVycy5cbiAgICAgICAgICogQHBhcmFtIHtPYmplY3R9IGBvcHRpb25zYCAoT3B0aW9uYWwpIE92ZXJyaWRlcyBmb3IgY29uZmlndXJhdGlvbiBvcHRpb25zLlxuICAgICAgICAgKi9cbiAgICAgICAgcGFyYWxsZWw6IGZ1bmN0aW9uIChvcGVyYXRpb25zLCBwYXJhbXMsIG9wdGlvbnMpIHtcbiAgICAgICAgICAgIHZhciAkZCA9ICQuRGVmZXJyZWQoKTtcblxuICAgICAgICAgICAgdmFyIG9wUGFyYW1zID0gcnV0aWwubm9ybWFsaXplT3BlcmF0aW9ucyhvcGVyYXRpb25zLCBwYXJhbXMpO1xuICAgICAgICAgICAgdmFyIG9wcyA9IG9wUGFyYW1zLm9wcztcbiAgICAgICAgICAgIHZhciBhcmdzID0gb3BQYXJhbXMuYXJncztcbiAgICAgICAgICAgIHZhciBwb3N0T3B0aW9ucyA9ICQuZXh0ZW5kKHRydWUsIHt9LCBzZXJ2aWNlT3B0aW9ucywgb3B0aW9ucyk7XG5cbiAgICAgICAgICAgIHZhciBxdWV1ZSAgPSBbXTtcbiAgICAgICAgICAgIGZvciAodmFyIGkgPSAwOyBpPCBvcHMubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgICAgICAgICBxdWV1ZS5wdXNoKFxuICAgICAgICAgICAgICAgICAgICB0aGlzLmRvKG9wc1tpXSwgYXJnc1tpXSlcbiAgICAgICAgICAgICAgICApO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgJC53aGVuLmFwcGx5KHRoaXMsIHF1ZXVlKVxuICAgICAgICAgICAgICAgIC5kb25lKGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgICAgICAgICAgJGQucmVzb2x2ZS5hcHBseSh0aGlzLCBhcmd1bWVudHMpO1xuICAgICAgICAgICAgICAgICAgICBwb3N0T3B0aW9ucy5zdWNjZXNzLmFwcGx5KHRoaXMuYXJndW1lbnRzKTtcbiAgICAgICAgICAgICAgICB9KVxuICAgICAgICAgICAgICAgIC5mYWlsKGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgICAgICAgICAgJGQucmVqZWN0LmFwcGx5KHRoaXMsIGFyZ3VtZW50cyk7XG4gICAgICAgICAgICAgICAgICAgIHBvc3RPcHRpb25zLmVycm9yLmFwcGx5KHRoaXMuYXJndW1lbnRzKTtcbiAgICAgICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgcmV0dXJuICRkLnByb21pc2UoKTtcbiAgICAgICAgfVxuICAgIH07XG5cbiAgICB2YXIgcHVibGljU3luY0FQSSA9IHtcbiAgICAgICAgLyoqXG4gICAgICAgICAqIFJldHVybnMgYSBWYXJpYWJsZXMgU2VydmljZSBpbnN0YW5jZS4gVXNlIHRoZSB2YXJpYWJsZXMgaW5zdGFuY2UgdG8gbG9hZCwgc2F2ZSwgYW5kIHF1ZXJ5IGZvciBzcGVjaWZpYyBtb2RlbCB2YXJpYWJsZXMuIFNlZSB0aGUgW1ZhcmlhYmxlIEFQSSBTZXJ2aWNlXSguLi92YXJpYWJsZXMtYXBpLXNlcnZpY2UvKSBmb3IgbW9yZSBpbmZvcm1hdGlvbi5cbiAgICAgICAgICpcbiAgICAgICAgICogKipFeGFtcGxlKipcbiAgICAgICAgICpcbiAgICAgICAgICogICAgICB2YXIgdnMgPSBycy52YXJpYWJsZXMoKTtcbiAgICAgICAgICogICAgICB2cy5zYXZlKHsgc2FtcGxlX2ludDogNH0pO1xuICAgICAgICAgKlxuICAgICAgICAgKiAqKlBhcmFtZXRlcnMqKlxuICAgICAgICAgKiBAcGFyYW0ge09iamVjdH0gYGNvbmZpZ2AgKE9wdGlvbmFsKSBPdmVycmlkZXMgZm9yIGNvbmZpZ3VyYXRpb24gb3B0aW9ucy5cbiAgICAgICAgICovXG5cbiAgICAgICAgdmFyaWFibGVzOiBmdW5jdGlvbiAoY29uZmlnKSB7XG4gICAgICAgICAgICB2YXIgdnMgPSBuZXcgVmFyaWFibGVzU2VydmljZSgkLmV4dGVuZCh0cnVlLCB7fSwgc2VydmljZU9wdGlvbnMsIGNvbmZpZywge1xuICAgICAgICAgICAgICAgIHJ1blNlcnZpY2U6IHRoaXNcbiAgICAgICAgICAgIH0pKTtcbiAgICAgICAgICAgIHJldHVybiB2cztcbiAgICAgICAgfVxuICAgIH07XG5cbiAgICAkLmV4dGVuZCh0aGlzLCBwdWJsaWNBc3luY0FQSSk7XG4gICAgJC5leHRlbmQodGhpcywgcHVibGljU3luY0FQSSk7XG59O1xuXG4iLCIndXNlIHN0cmljdCc7XG4vKipcbiAqICMjU3RhdGUgQVBJIEFkYXB0ZXJcbiAqXG4gKiBUaGUgU3RhdGUgQVBJIEFkYXB0ZXIgYWxsb3dzIHlvdSB0byByZXBsYXkgb3IgY2xvbmUgcnVuc1xuICpcbiAqL1xuXG52YXIgQ29uZmlnU2VydmljZSA9IHJlcXVpcmUoJy4vY29uZmlndXJhdGlvbi1zZXJ2aWNlJyk7XG52YXIgVHJhbnNwb3J0RmFjdG9yeSA9IHJlcXVpcmUoJy4uL3RyYW5zcG9ydC9odHRwLXRyYW5zcG9ydC1mYWN0b3J5Jyk7XG52YXIgX3BpY2sgPSByZXF1aXJlKCcuLi91dGlsL29iamVjdC11dGlsJykuX3BpY2s7XG52YXIgYXBpRW5kcG9pbnQgPSAnbW9kZWwvc3RhdGUnO1xuXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uIChjb25maWcpIHtcblxuICAgIHZhciBkZWZhdWx0cyA9IHtcblxuICAgIH07XG5cbiAgICB2YXIgc2VydmljZU9wdGlvbnMgPSAkLmV4dGVuZCh7fSwgZGVmYXVsdHMsIGNvbmZpZyk7XG4gICAgdmFyIHVybENvbmZpZyA9IG5ldyBDb25maWdTZXJ2aWNlKHNlcnZpY2VPcHRpb25zKS5nZXQoJ3NlcnZlcicpO1xuXG4gICAgdmFyIHRyYW5zcG9ydE9wdGlvbnMgPSAkLmV4dGVuZCh0cnVlLCB7fSwgc2VydmljZU9wdGlvbnMudHJhbnNwb3J0LCB7XG4gICAgICAgIHVybDogdXJsQ29uZmlnLmdldEFQSVBhdGgoYXBpRW5kcG9pbnQpXG4gICAgfSk7XG5cbiAgICBpZiAoc2VydmljZU9wdGlvbnMudG9rZW4pIHtcbiAgICAgICAgdHJhbnNwb3J0T3B0aW9ucy5oZWFkZXJzID0ge1xuICAgICAgICAgICAgJ0F1dGhvcml6YXRpb24nOiAnQmVhcmVyICcgKyBzZXJ2aWNlT3B0aW9ucy50b2tlblxuICAgICAgICB9O1xuICAgIH1cblxuICAgIHZhciBodHRwID0gbmV3IFRyYW5zcG9ydEZhY3RvcnkodHJhbnNwb3J0T3B0aW9ucyk7XG5cbiAgICB2YXIgcHVibGljQVBJID0ge1xuICAgICAgICAvKipcbiAgICAgICAgKiBSZXBsYXlzIGEgcnVuIHRvIGdldCBpdCBiYWNrIGludG8gbWVtb3J5XG4gICAgICAgICpcbiAgICAgICAgKlxuICAgICAgICAqICoqUEFSQU1FVEVSUyoqXG4gICAgICAgICogQHBhcmFtIHtvYmplY3R9IGBwYXJhbXNgIFBhcmFtZXRlcnMgb2JqZWN0XG4gICAgICAgICogQHBhcmFtIHtzdHJpbmd9IGBwYXJhbXMucnVuSWRgIGlkIG9mIHRoZSBydW4gdG8gYnJpbmcgYmFjayB0byBtZW1vcnlcbiAgICAgICAgKiBAcGFyYW0ge3N0cmluZ30gKE9wdGlvbmFsKSBgcGFyYW0uc3RvcEJlZm9yZWAgLSB0aGUgcnVuIGlzIGFkdmFuY2VkIG9ubHkgdXAgdG8gdGhlIGZpcnN0IG9jY3VycmVuY2Ugb2YgdGhhdCBtZXRob2RcbiAgICAgICAgKiBAcGFyYW0ge29iamVjdH0gKE9wdGlvbmFsKSBgb3B0aW9uc2AgLSBPcHRpb25zIG92ZXJyaWRlXG4gICAgICAgICovXG4gICAgICAgIHJlcGxheTogZnVuY3Rpb24gKHBhcmFtcywgb3B0aW9ucykge1xuICAgICAgICAgICAgdmFyIHJlcGxheU9wdGlvbnMgPSAkLmV4dGVuZCh0cnVlLCB7fSxcbiAgICAgICAgICAgICAgICBzZXJ2aWNlT3B0aW9ucyxcbiAgICAgICAgICAgICAgICBvcHRpb25zLFxuICAgICAgICAgICAgICAgIHsgdXJsOiB1cmxDb25maWcuZ2V0QVBJUGF0aChhcGlFbmRwb2ludCkgKyBwYXJhbXMucnVuSWQgfVxuICAgICAgICAgICAgKTtcblxuICAgICAgICAgICAgcGFyYW1zID0gJC5leHRlbmQodHJ1ZSwgeyBhY3Rpb246ICdyZXBsYXknIH0sIF9waWNrKHBhcmFtcywgJ3N0b3BCZWZvcmUnKSk7XG5cbiAgICAgICAgICAgIHJldHVybiBodHRwLnBvc3QocGFyYW1zLCByZXBsYXlPcHRpb25zKTtcbiAgICAgICAgfSxcblxuICAgICAgICAvKipcbiAgICAgICAgKiBDbG9uZXMgYSBnaXZlbiBydW4gYW5kIHJldHVybnMgYSBuZXcgcnVuIGluIHRoZSBzYW1lIHN0YXRlIGFzIHRoZSBnaXZlbiBydW5cbiAgICAgICAgKlxuICAgICAgICAqXG4gICAgICAgICogKipQQVJBTUVURVJTKipcbiAgICAgICAgKiBAcGFyYW0ge29iamVjdH0gYHBhcmFtc2AgUGFyYW1ldGVycyBvYmplY3RcbiAgICAgICAgKiBAcGFyYW0ge3N0cmluZ30gYHBhcmFtcy5ydW5JZGAgaWQgb2YgdGhlIHJ1biB0byBicmluZyBiYWNrIHRvIG1lbW9yeVxuICAgICAgICAqIEBwYXJhbSB7c3RyaW5nfSAoT3B0aW9uYWwpIGBwYXJhbS5zdG9wQmVmb3JlYCAtIHRoZSBydW4gaXMgYWR2YW5jZWQgb25seSB1cCB0byB0aGUgZmlyc3Qgb2NjdXJyZW5jZSBvZiB0aGF0IG1ldGhvZFxuICAgICAgICAqIEBwYXJhbSB7b2JqZWN0fSAoT3B0aW9uYWwpIGBvcHRpb25zYCAtIE9wdGlvbnMgb3ZlcnJpZGVcbiAgICAgICAgKi9cbiAgICAgICAgY2xvbmU6IGZ1bmN0aW9uIChwYXJhbXMsIG9wdGlvbnMpIHtcbiAgICAgICAgICAgIHZhciByZXBsYXlPcHRpb25zID0gJC5leHRlbmQodHJ1ZSwge30sXG4gICAgICAgICAgICAgICAgc2VydmljZU9wdGlvbnMsXG4gICAgICAgICAgICAgICAgb3B0aW9ucyxcbiAgICAgICAgICAgICAgICB7IHVybDogdXJsQ29uZmlnLmdldEFQSVBhdGgoYXBpRW5kcG9pbnQpICsgcGFyYW1zLnJ1bklkIH1cbiAgICAgICAgICAgICk7XG5cbiAgICAgICAgICAgIHBhcmFtcyA9ICQuZXh0ZW5kKHRydWUsIHsgYWN0aW9uOiAnY2xvbmUnIH0sIF9waWNrKHBhcmFtcywgJ3N0b3BCZWZvcmUnKSk7XG5cbiAgICAgICAgICAgIHJldHVybiBodHRwLnBvc3QocGFyYW1zLCByZXBsYXlPcHRpb25zKTtcbiAgICAgICAgfVxuICAgIH07XG5cbiAgICAkLmV4dGVuZCh0aGlzLCBwdWJsaWNBUEkpO1xufTsiLCIndXNlIHN0cmljdCc7XG5cbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24gKGNvbmZpZykge1xuICAgIC8vVE9ETzogdXJsdXRpbHMgdG8gZ2V0IGhvc3QsIHNpbmNlIG5vIHdpbmRvdyBvbiBub2RlXG5cbiAgICB2YXIgQVBJX1BST1RPQ09MID0gJ2h0dHBzJztcbiAgICB2YXIgSE9TVF9BUElfTUFQUElORyA9IHtcbiAgICAgICAgJ2ZvcmlvLmNvbSc6ICdhcGkuZm9yaW8uY29tJyxcbiAgICAgICAgJ2ZvcmlvZGV2LmNvbSc6ICdhcGkuZXBpY2VudGVyLmZvcmlvZGV2LmNvbSdcbiAgICB9O1xuXG4gICAgdmFyIHB1YmxpY0V4cG9ydHMgPSB7XG4gICAgICAgIHByb3RvY29sOiBBUElfUFJPVE9DT0wsXG5cbiAgICAgICAgYXBpOiAnJyxcblxuICAgICAgICBob3N0OiAoZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgdmFyIGhvc3QgPSB3aW5kb3cubG9jYXRpb24uaG9zdDtcbiAgICAgICAgICAgIGlmICghaG9zdCB8fCBob3N0LmluZGV4T2YoJ2xvY2FsJykgIT09IC0xKSB7XG4gICAgICAgICAgICAgICAgaG9zdCA9ICdmb3Jpby5jb20nO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgcmV0dXJuIChIT1NUX0FQSV9NQVBQSU5HW2hvc3RdKSA/IEhPU1RfQVBJX01BUFBJTkdbaG9zdF0gOiAnYXBpLicgKyBob3N0O1xuICAgICAgICB9KCkpLFxuXG4gICAgICAgIGFwcFBhdGg6IChmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICB2YXIgcGF0aCA9IHdpbmRvdy5sb2NhdGlvbi5wYXRobmFtZS5zcGxpdCgnXFwvJyk7XG5cbiAgICAgICAgICAgIHJldHVybiBwYXRoICYmIHBhdGhbMV0gfHwgJyc7XG4gICAgICAgIH0oKSksXG5cbiAgICAgICAgYWNjb3VudFBhdGg6IChmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICB2YXIgYWNjbnQgPSAnJztcbiAgICAgICAgICAgIHZhciBwYXRoID0gd2luZG93LmxvY2F0aW9uLnBhdGhuYW1lLnNwbGl0KCdcXC8nKTtcbiAgICAgICAgICAgIGlmIChwYXRoICYmIHBhdGhbMV0gPT09ICdhcHAnKSB7XG4gICAgICAgICAgICAgICAgYWNjbnQgPSBwYXRoWzJdO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgcmV0dXJuIGFjY250O1xuICAgICAgICB9KCkpLFxuXG4gICAgICAgIHByb2plY3RQYXRoOiAoZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgdmFyIHByaiA9ICcnO1xuICAgICAgICAgICAgdmFyIHBhdGggPSB3aW5kb3cubG9jYXRpb24ucGF0aG5hbWUuc3BsaXQoJ1xcLycpO1xuICAgICAgICAgICAgaWYgKHBhdGggJiYgcGF0aFsxXSA9PT0gJ2FwcCcpIHtcbiAgICAgICAgICAgICAgICBwcmogPSBwYXRoWzNdO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgcmV0dXJuIHByajtcbiAgICAgICAgfSgpKSxcblxuICAgICAgICBnZXRBUElQYXRoOiBmdW5jdGlvbiAoYXBpKSB7XG4gICAgICAgICAgICB2YXIgUFJPSkVDVF9BUElTID0gWydydW4nLCAnZGF0YSddO1xuICAgICAgICAgICAgdmFyIGFwaVBhdGggPSB0aGlzLnByb3RvY29sICsgJzovLycgKyB0aGlzLmhvc3QgKyAnLycgKyBhcGkgKyAnLyc7XG5cbiAgICAgICAgICAgIGlmICgkLmluQXJyYXkoYXBpLCBQUk9KRUNUX0FQSVMpICE9PSAtMSkge1xuICAgICAgICAgICAgICAgIGFwaVBhdGggKz0gdGhpcy5hY2NvdW50UGF0aCArICcvJyArIHRoaXMucHJvamVjdFBhdGggICsgJy8nO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgcmV0dXJuIGFwaVBhdGg7XG4gICAgICAgIH1cbiAgICB9O1xuXG4gICAgJC5leHRlbmQocHVibGljRXhwb3J0cywgY29uZmlnKTtcbiAgICByZXR1cm4gcHVibGljRXhwb3J0cztcbn07XG4iLCIndXNlIHN0cmljdCc7XG4vKipcbiogIyNVc2VyIEFQSSBBZGFwdGVyXG4qXG4qIFRoZSB1c2VyIEFQSSBhZGFwdGVyIGFsbG93cyB5b3UgdG8gcXVlcnQgdGhlIC91c2VyIEFQSVxuKlxuKlxuKi9cblxudmFyIENvbmZpZ1NlcnZpY2UgPSByZXF1aXJlKCcuL2NvbmZpZ3VyYXRpb24tc2VydmljZScpO1xudmFyIFRyYW5zcG9ydEZhY3RvcnkgPSByZXF1aXJlKCcuLi90cmFuc3BvcnQvaHR0cC10cmFuc3BvcnQtZmFjdG9yeScpO1xudmFyIHF1dGlsID0gcmVxdWlyZSgnLi4vdXRpbC9xdWVyeS11dGlsJyk7XG5cbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24gKGNvbmZpZykge1xuICAgIHZhciBkZWZhdWx0cyA9IHtcblxuICAgICAgIGFjY291bnQ6ICcnLFxuXG4gICAgICAgdG9rZW46ICcnLFxuXG4gICAgICAgIC8vT3B0aW9ucyB0byBwYXNzIG9uIHRvIHRoZSB1bmRlcmx5aW5nIHRyYW5zcG9ydCBsYXllclxuICAgICAgICB0cmFuc3BvcnQ6IHt9XG4gICAgfTtcblxuICAgIHZhciBzZXJ2aWNlT3B0aW9ucyA9ICQuZXh0ZW5kKHt9LCBkZWZhdWx0cywgY29uZmlnKTtcbiAgICB2YXIgdXJsQ29uZmlnID0gbmV3IENvbmZpZ1NlcnZpY2Uoc2VydmljZU9wdGlvbnMpLmdldCgnc2VydmVyJyk7XG4gICAgdmFyIHRyYW5zcG9ydE9wdGlvbnMgPSAkLmV4dGVuZCh0cnVlLCB7fSwgc2VydmljZU9wdGlvbnMudHJhbnNwb3J0LCB7XG4gICAgICAgIHVybDogdXJsQ29uZmlnLmdldEFQSVBhdGgoJ3VzZXInKVxuICAgIH0pO1xuXG4gICAgaWYgKHNlcnZpY2VPcHRpb25zLnRva2VuKSB7XG4gICAgICAgIHRyYW5zcG9ydE9wdGlvbnMuaGVhZGVycyA9IHtcbiAgICAgICAgICAgICdBdXRob3JpemF0aW9uJzogJ0JlYXJlciAnICsgc2VydmljZU9wdGlvbnMudG9rZW5cbiAgICAgICAgfTtcbiAgICB9XG5cbiAgICB2YXIgaHR0cCA9IG5ldyBUcmFuc3BvcnRGYWN0b3J5KHRyYW5zcG9ydE9wdGlvbnMpO1xuXG4gICAgdmFyIHB1YmxpY0FQSSA9IHtcbiAgICAgICAgZ2V0OiBmdW5jdGlvbiAoZmlsdGVyLCBvcHRpb25zKSB7XG4gICAgICAgICAgICBvcHRpb25zID0gb3B0aW9ucyB8fCB7fTtcbiAgICAgICAgICAgIGZpbHRlciA9IGZpbHRlciB8fCB7fTtcblxuICAgICAgICAgICAgdmFyIGdldE9wdGlvbnMgPSAkLmV4dGVuZCh0cnVlLCB7fSxcbiAgICAgICAgICAgICAgICBzZXJ2aWNlT3B0aW9ucyxcbiAgICAgICAgICAgICAgICBvcHRpb25zXG4gICAgICAgICAgICApO1xuXG4gICAgICAgICAgICB2YXIgdG9RRmlsdGVyID0gZnVuY3Rpb24gKGZpbHRlcikge1xuICAgICAgICAgICAgICAgIHZhciByZXMgPSB7fTtcblxuICAgICAgICAgICAgICAgIC8vIEFQSSBvbmx5IHN1cHBvcnRzIGZpbHRlcmluZyBieSB1c2VybmFtZSBmb3Igbm93XG4gICAgICAgICAgICAgICAgaWYgKGZpbHRlci51c2VyTmFtZSkge1xuICAgICAgICAgICAgICAgICAgICByZXMucSA9IGZpbHRlci51c2VyTmFtZTtcbiAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICByZXR1cm4gcmVzO1xuICAgICAgICAgICAgfTtcblxuICAgICAgICAgICAgdmFyIHRvSWRGaWx0ZXJzID0gZnVuY3Rpb24gKGlkKSB7XG4gICAgICAgICAgICAgICAgaWYgKCFpZCkge1xuICAgICAgICAgICAgICAgICAgICByZXR1cm4gJyc7XG4gICAgICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICAgICAgaWQgPSAkLmlzQXJyYXkoaWQpID8gaWQgOiBbaWRdO1xuICAgICAgICAgICAgICAgIHJldHVybiAnaWQ9JyArIGlkLmpvaW4oJyZpZD0nKTtcbiAgICAgICAgICAgIH07XG5cbiAgICAgICAgICAgIHZhciBnZXRGaWx0ZXJzID0gW1xuICAgICAgICAgICAgICAgICdhY2NvdW50PScgKyBnZXRPcHRpb25zLmFjY291bnQsXG4gICAgICAgICAgICAgICAgdG9JZEZpbHRlcnMoZmlsdGVyLmlkKSxcbiAgICAgICAgICAgICAgICBxdXRpbC50b1F1ZXJ5Rm9ybWF0KHRvUUZpbHRlcihmaWx0ZXIpKVxuICAgICAgICAgICAgXS5qb2luKCcmJyk7XG5cbiAgICAgICAgICAgIC8vIHNwZWNpYWwgY2FzZSBmb3IgcXVlcmllcyB3aXRoIGxhcmdlIG51bWJlciBvZiBpZHNcbiAgICAgICAgICAgIC8vIG1ha2UgaXQgYXMgYSBwb3N0IHdpdGggR0VUIHNlbWFudGljc1xuICAgICAgICAgICAgdmFyIHRocmVzaG9sZCA9IDMwO1xuICAgICAgICAgICAgaWYgKGZpbHRlci5pZCAmJiAkLmlzQXJyYXkoZmlsdGVyLmlkKSAmJiBmaWx0ZXIuaWQubGVuZ3RoID49IHRocmVzaG9sZCkge1xuICAgICAgICAgICAgICAgIGdldE9wdGlvbnMudXJsID0gdXJsQ29uZmlnLmdldEFQSVBhdGgoJ3VzZXInKSArICc/X21ldGhvZD1HRVQnO1xuICAgICAgICAgICAgICAgIHJldHVybiBodHRwLnBvc3QoeyBpZDogZmlsdGVyLmlkIH0sIGdldE9wdGlvbnMpO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gaHR0cC5nZXQoZ2V0RmlsdGVycywgZ2V0T3B0aW9ucyk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0sXG5cbiAgICAgICAgZ2V0QnlJZDogZnVuY3Rpb24gKHVzZXJJZCwgb3B0aW9ucykge1xuICAgICAgICAgICAgcmV0dXJuIHB1YmxpY0FQSS5nZXQoeyBpZDogdXNlcklkIH0sIG9wdGlvbnMpO1xuICAgICAgICB9XG4gICAgfTtcblxuICAgICQuZXh0ZW5kKHRoaXMsIHB1YmxpY0FQSSk7XG59O1xuXG5cblxuXG4iLCIvKipcbiAqXG4gKiAjI1ZhcmlhYmxlcyBBUEkgU2VydmljZVxuICpcbiAqIFVzZWQgaW4gY29uanVuY3Rpb24gd2l0aCB0aGUgW1J1biBBUEkgU2VydmljZV0oLi4vcnVuLWFwaS1zZXJ2aWNlLykgdG8gcmVhZCwgd3JpdGUsIGFuZCBzZWFyY2ggZm9yIHNwZWNpZmljIG1vZGVsIHZhcmlhYmxlcy5cbiAqXG4gKiAgICAgdmFyIHJtID0gbmV3IEYubWFuYWdlci5SdW5NYW5hZ2VyKHtcbiAqICAgICAgICAgICBydW46IHtcbiAqICAgICAgICAgICAgICAgYWNjb3VudDogJ2FjbWUtc2ltdWxhdGlvbnMnLFxuICogICAgICAgICAgICAgICBwcm9qZWN0OiAnc3VwcGx5LWNoYWluLWdhbWUnLFxuICogICAgICAgICAgICAgICBtb2RlbDogJ3N1cHBseS1jaGFpbi1tb2RlbC5qbCdcbiAqICAgICAgICAgICB9XG4gKiAgICAgIH0pO1xuICogICAgIHJtLmdldFJ1bigpXG4gKiAgICAgICAudGhlbihmdW5jdGlvbigpIHtcbiAqICAgICAgICAgIHZhciB2cyA9IHJtLnJ1bi52YXJpYWJsZXMoKTtcbiAqICAgICAgICAgIHZzLnNhdmUoe3NhbXBsZV9pbnQ6IDR9KTtcbiAqICAgICAgICB9KTtcbiAqXG4gKi9cblxuXG4gJ3VzZSBzdHJpY3QnO1xuXG4gdmFyIFRyYW5zcG9ydEZhY3RvcnkgPSByZXF1aXJlKCcuLi90cmFuc3BvcnQvaHR0cC10cmFuc3BvcnQtZmFjdG9yeScpO1xuXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uIChjb25maWcpIHtcbiAgICB2YXIgZGVmYXVsdHMgPSB7XG4gICAgICAgIC8qKlxuICAgICAgICAgKiBUaGUgcnVucyBvYmplY3QgdG8gd2hpY2ggdGhlIHZhcmlhYmxlIGZpbHRlcnMgYXBwbHkuIERlZmF1bHRzIHRvIG51bGwuXG4gICAgICAgICAqIEB0eXBlIHtydW5TZXJ2aWNlfVxuICAgICAgICAgKi9cbiAgICAgICAgcnVuU2VydmljZTogbnVsbFxuICAgIH07XG4gICAgdmFyIHNlcnZpY2VPcHRpb25zID0gJC5leHRlbmQoe30sIGRlZmF1bHRzLCBjb25maWcpO1xuXG4gICAgdmFyIGdldFVSTCA9IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgcmV0dXJuIHNlcnZpY2VPcHRpb25zLnJ1blNlcnZpY2UudXJsQ29uZmlnLmdldEZpbHRlclVSTCgpICsgJ3ZhcmlhYmxlcy8nO1xuICAgIH07XG5cbiAgICB2YXIgaHR0cE9wdGlvbnMgPSB7XG4gICAgICAgIHVybDogZ2V0VVJMXG4gICAgfTtcbiAgICBpZiAoc2VydmljZU9wdGlvbnMudG9rZW4pIHtcbiAgICAgICAgaHR0cE9wdGlvbnMuaGVhZGVycyA9IHtcbiAgICAgICAgICAgICdBdXRob3JpemF0aW9uJzogJ0JlYXJlciAnICsgc2VydmljZU9wdGlvbnMudG9rZW5cbiAgICAgICAgfTtcbiAgICB9XG4gICAgdmFyIGh0dHAgPSBuZXcgVHJhbnNwb3J0RmFjdG9yeShodHRwT3B0aW9ucyk7XG5cbiAgICB2YXIgcHVibGljQVBJID0ge1xuXG4gICAgICAgIC8qKlxuICAgICAgICAgKiBHZXQgdmFsdWVzIGZvciBhIHZhcmlhYmxlLlxuICAgICAgICAgKlxuICAgICAgICAgKiAqKkV4YW1wbGUqKlxuICAgICAgICAgKlxuICAgICAgICAgKiAgICAgIHZzLmxvYWQoJ3NhbXBsZV9pbnQnKTtcbiAgICAgICAgICpcbiAgICAgICAgICogKipQYXJhbWV0ZXJzKipcbiAgICAgICAgICogQHBhcmFtIHtTdHJpbmd9IGB2YXJpYWJsZWAgTmFtZSBvZiB2YXJpYWJsZSB0byBsb2FkLlxuICAgICAgICAgKiBAcGFyYW0ge09iamVjdH0gYG91dHB1dE1vZGlmaWVyYCAoT3B0aW9uYWwpIEF2YWlsYWJsZSBmaWVsZHMgaW5jbHVkZTogYHN0YXJ0cmVjb3JkYCwgYGVuZHJlY29yZGAsIGBzb3J0YCwgYW5kIGBkaXJlY3Rpb25gIChgYXNjYCBvciBgZGVzY2ApLlxuICAgICAgICAgKiBAcGFyYW0ge09iamVjdH0gYG9wdGlvbnNgIChPcHRpb25hbCkgT3ZlcnJpZGVzIGZvciBjb25maWd1cmF0aW9uIG9wdGlvbnMuXG4gICAgICAgICAqL1xuICAgICAgICBsb2FkOiBmdW5jdGlvbiAodmFyaWFibGUsIG91dHB1dE1vZGlmaWVyLCBvcHRpb25zKSB7XG4gICAgICAgICAgICB2YXIgaHR0cE9wdGlvbnMgPSAkLmV4dGVuZCh0cnVlLCB7fSwgc2VydmljZU9wdGlvbnMsIG9wdGlvbnMpO1xuICAgICAgICAgICAgcmV0dXJuIGh0dHAuZ2V0KG91dHB1dE1vZGlmaWVyLCAkLmV4dGVuZCh7fSwgaHR0cE9wdGlvbnMsIHtcbiAgICAgICAgICAgICAgICB1cmw6IGdldFVSTCgpICsgdmFyaWFibGUgKyAnLydcbiAgICAgICAgICAgIH0pKTtcbiAgICAgICAgfSxcblxuICAgICAgICAvKipcbiAgICAgICAgICogUmV0dXJucyBwYXJ0aWN1bGFyIHZhcmlhYmxlcywgYmFzZWQgb24gY29uZGl0aW9ucyBzcGVjaWZpZWQgaW4gdGhlIGBxdWVyeWAgb2JqZWN0LlxuICAgICAgICAgKlxuICAgICAgICAgKiAqKkV4YW1wbGUqKlxuICAgICAgICAgKlxuICAgICAgICAgKiAgICAgIHZzLnF1ZXJ5KFsncHJpY2UnLCAnc2FsZXMnXSk7XG4gICAgICAgICAqICAgICAgdnMucXVlcnkoeyBpbmNsdWRlOlsncHJpY2UnLCAnc2FsZXMnXSB9KTtcbiAgICAgICAgICpcbiAgICAgICAgICogKipQYXJhbWV0ZXJzKipcbiAgICAgICAgICogQHBhcmFtIHtPYmplY3R8QXJyYXl9IGBxdWVyeWAgVGhlIG5hbWVzIG9mIHRoZSB2YXJpYWJsZXMgcmVxdWVzdGVkLlxuICAgICAgICAgKiBAcGFyYW0ge09iamVjdH0gYG91dHB1dE1vZGlmaWVyYCAoT3B0aW9uYWwpIEF2YWlsYWJsZSBmaWVsZHMgaW5jbHVkZTogYHN0YXJ0cmVjb3JkYCwgYGVuZHJlY29yZGAsIGBzb3J0YCwgYW5kIGBkaXJlY3Rpb25gIChgYXNjYCBvciBgZGVzY2ApLlxuICAgICAgICAgKiBAcGFyYW0ge09iamVjdH0gYG9wdGlvbnNgIChPcHRpb25hbCkgT3ZlcnJpZGVzIGZvciBjb25maWd1cmF0aW9uIG9wdGlvbnMuXG4gICAgICAgICAqXG4gICAgICAgICAqL1xuICAgICAgICBxdWVyeTogZnVuY3Rpb24gKHF1ZXJ5LCBvdXRwdXRNb2RpZmllciwgb3B0aW9ucykge1xuICAgICAgICAgICAgLy9RdWVyeSBhbmQgb3V0cHV0TW9kaWZpZXIgYXJlIGJvdGggcXVlcnlzdHJpbmdzIGluIHRoZSB1cmw7IG9ubHkgY2FsbGluZyB0aGVtIG91dCBzZXBhcmF0ZWx5IGhlcmUgdG8gYmUgY29uc2lzdGVudCB3aXRoIHRoZSBvdGhlciBjYWxsc1xuICAgICAgICAgICAgdmFyIGh0dHBPcHRpb25zID0gJC5leHRlbmQodHJ1ZSwge30sIHNlcnZpY2VPcHRpb25zLCBvcHRpb25zKTtcblxuICAgICAgICAgICAgaWYgKCQuaXNBcnJheShxdWVyeSkpIHtcbiAgICAgICAgICAgICAgICBxdWVyeSA9IHsgaW5jbHVkZTogcXVlcnkgfTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgICQuZXh0ZW5kKHF1ZXJ5LCBvdXRwdXRNb2RpZmllcik7XG4gICAgICAgICAgICByZXR1cm4gaHR0cC5nZXQocXVlcnksIGh0dHBPcHRpb25zKTtcbiAgICAgICAgfSxcblxuICAgICAgICAvKipcbiAgICAgICAgICogU2F2ZSB2YWx1ZXMgdG8gbW9kZWwgdmFyaWFibGVzLiBPdmVyd3JpdGVzIGV4aXN0aW5nIHZhbHVlcy4gTm90ZSB0aGF0IHlvdSBjYW4gb25seSB1cGRhdGUgbW9kZWwgdmFyaWFibGVzIGlmIHRoZSBydW4gaXMgW2luIG1lbW9yeV0oLi4vLi4vLi4vcnVuX3BlcnNpc3RlbmNlLyNydW5zLWluLW1lbW9yeSkuIChBbiBhbHRlcm5hdGUgd2F5IHRvIHVwZGF0ZSBtb2RlbCB2YXJpYWJsZXMgaXMgdG8gY2FsbCBhIG1ldGhvZCBmcm9tIHRoZSBtb2RlbCBhbmQgbWFrZSBzdXJlIHRoYXQgdGhlIG1ldGhvZCBwZXJzaXN0cyB0aGUgdmFyaWFibGVzLiBTZWUgYGRvYCwgYHNlcmlhbGAsIGFuZCBgcGFyYWxsZWxgIGluIHRoZSBbUnVuIEFQSSBTZXJ2aWNlXSguLi9ydW4tYXBpLXNlcnZpY2UvKSBmb3IgY2FsbGluZyBtZXRob2RzIGZyb20gdGhlIG1vZGVsLilcbiAgICAgICAgICpcbiAgICAgICAgICogKipFeGFtcGxlKipcbiAgICAgICAgICpcbiAgICAgICAgICogICAgICB2cy5zYXZlKCdwcmljZScsIDQpO1xuICAgICAgICAgKiAgICAgIHZzLnNhdmUoeyBwcmljZTogNCwgcXVhbnRpdHk6IDUsIHByb2R1Y3RzOiBbMiwzLDRdIH0pO1xuICAgICAgICAgKlxuICAgICAgICAgKiAqKlBhcmFtZXRlcnMqKlxuICAgICAgICAgKiBAcGFyYW0ge09iamVjdHxTdHJpbmd9IGB2YXJpYWJsZWAgQW4gb2JqZWN0IGNvbXBvc2VkIG9mIHRoZSBtb2RlbCB2YXJpYWJsZXMgYW5kIHRoZSB2YWx1ZXMgdG8gc2F2ZS4gQWx0ZXJuYXRpdmVseSwgYSBzdHJpbmcgd2l0aCB0aGUgbmFtZSBvZiB0aGUgdmFyaWFibGUuXG4gICAgICAgICAqIEBwYXJhbSB7T2JqZWN0fSBgdmFsYCAoT3B0aW9uYWwpIElmIHBhc3NpbmcgYSBzdHJpbmcgZm9yIGB2YXJpYWJsZWAsIHVzZSB0aGlzIGFyZ3VtZW50IGZvciB0aGUgdmFsdWUgdG8gc2F2ZS5cbiAgICAgICAgICogQHBhcmFtIHtPYmplY3R9IGBvcHRpb25zYCAoT3B0aW9uYWwpIE92ZXJyaWRlcyBmb3IgY29uZmlndXJhdGlvbiBvcHRpb25zLlxuICAgICAgICAgKi9cbiAgICAgICAgc2F2ZTogZnVuY3Rpb24gKHZhcmlhYmxlLCB2YWwsIG9wdGlvbnMpIHtcbiAgICAgICAgICAgIHZhciBhdHRycztcbiAgICAgICAgICAgIGlmICh0eXBlb2YgdmFyaWFibGUgPT09ICdvYmplY3QnKSB7XG4gICAgICAgICAgICAgICAgYXR0cnMgPSB2YXJpYWJsZTtcbiAgICAgICAgICAgICAgICBvcHRpb25zID0gdmFsO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICAoYXR0cnMgPSB7fSlbdmFyaWFibGVdID0gdmFsO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgdmFyIGh0dHBPcHRpb25zID0gJC5leHRlbmQodHJ1ZSwge30sIHNlcnZpY2VPcHRpb25zLCBvcHRpb25zKTtcblxuICAgICAgICAgICAgcmV0dXJuIGh0dHAucGF0Y2guY2FsbCh0aGlzLCBhdHRycywgaHR0cE9wdGlvbnMpO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gTm90IEF2YWlsYWJsZSB1bnRpbCB1bmRlcmx5aW5nIEFQSSBzdXBwb3J0cyBQVVQuIE90aGVyd2lzZSBzYXZlIHdvdWxkIGJlIFBVVCBhbmQgbWVyZ2Ugd291bGQgYmUgUEFUQ0hcbiAgICAgICAgLy8gKlxuICAgICAgICAvLyAgKiBTYXZlIHZhbHVlcyB0byB0aGUgYXBpLiBNZXJnZXMgYXJyYXlzLCBidXQgb3RoZXJ3aXNlIHNhbWUgYXMgc2F2ZVxuICAgICAgICAvLyAgKiBAcGFyYW0ge09iamVjdHxTdHJpbmd9IHZhcmlhYmxlIE9iamVjdCB3aXRoIGF0dHJpYnV0ZXMsIG9yIHN0cmluZyBrZXlcbiAgICAgICAgLy8gICogQHBhcmFtIHtPYmplY3R9IHZhbCBPcHRpb25hbCBpZiBwcmV2IHBhcmFtZXRlciB3YXMgYSBzdHJpbmcsIHNldCB2YWx1ZSBoZXJlXG4gICAgICAgIC8vICAqIEBwYXJhbSB7T2JqZWN0fSBvcHRpb25zIE92ZXJyaWRlcyBmb3IgY29uZmlndXJhdGlvbiBvcHRpb25zXG4gICAgICAgIC8vICAqXG4gICAgICAgIC8vICAqIEBleGFtcGxlXG4gICAgICAgIC8vICAqICAgICB2cy5tZXJnZSh7IHByaWNlOiA0LCBxdWFudGl0eTogNSwgcHJvZHVjdHM6IFsyLDMsNF0gfSlcbiAgICAgICAgLy8gICogICAgIHZzLm1lcmdlKCdwcmljZScsIDQpO1xuXG4gICAgICAgIC8vIG1lcmdlOiBmdW5jdGlvbiAodmFyaWFibGUsIHZhbCwgb3B0aW9ucykge1xuICAgICAgICAvLyAgICAgdmFyIGF0dHJzO1xuICAgICAgICAvLyAgICAgaWYgKHR5cGVvZiB2YXJpYWJsZSA9PT0gJ29iamVjdCcpIHtcbiAgICAgICAgLy8gICAgICAgYXR0cnMgPSB2YXJpYWJsZTtcbiAgICAgICAgLy8gICAgICAgb3B0aW9ucyA9IHZhbDtcbiAgICAgICAgLy8gICAgIH0gZWxzZSB7XG4gICAgICAgIC8vICAgICAgIChhdHRycyA9IHt9KVt2YXJpYWJsZV0gPSB2YWw7XG4gICAgICAgIC8vICAgICB9XG4gICAgICAgIC8vICAgICB2YXIgaHR0cE9wdGlvbnMgPSAkLmV4dGVuZCh0cnVlLCB7fSwgc2VydmljZU9wdGlvbnMsIG9wdGlvbnMpO1xuXG4gICAgICAgIC8vICAgICByZXR1cm4gaHR0cC5wYXRjaC5jYWxsKHRoaXMsIGF0dHJzLCBodHRwT3B0aW9ucyk7XG4gICAgICAgIC8vIH1cbiAgICB9O1xuICAgICQuZXh0ZW5kKHRoaXMsIHB1YmxpY0FQSSk7XG59O1xuIiwiLyoqXG4gKiAjI1dvcmxkIEFQSSBBZGFwdGVyXG4gKlxuICogQSBbcnVuXSguLi8uLi8uLi9nbG9zc2FyeS8jcnVuKSBpcyBhIGNvbGxlY3Rpb24gb2YgZW5kIHVzZXIgaW50ZXJhY3Rpb25zIHdpdGggYSBwcm9qZWN0IGFuZCBpdHMgbW9kZWwgLS0gaW5jbHVkaW5nIHNldHRpbmcgdmFyaWFibGVzLCBtYWtpbmcgZGVjaXNpb25zLCBhbmQgY2FsbGluZyBvcGVyYXRpb25zLiBGb3IgYnVpbGRpbmcgbXVsdGlwbGF5ZXIgc2ltdWxhdGlvbnMgeW91IHR5cGljYWxseSB3YW50IG11bHRpcGxlIGVuZCB1c2VycyB0byBzaGFyZSB0aGUgc2FtZSBzZXQgb2YgaW50ZXJhY3Rpb25zLCBhbmQgd29yayB3aXRoaW4gYSBjb21tb24gc3RhdGUuIEVwaWNlbnRlciBhbGxvd3MgeW91IHRvIGNyZWF0ZSBcIndvcmxkc1wiIHRvIGhhbmRsZSBzdWNoIGNhc2VzLlxuICpcbiAqIFRoZSBXb3JsZCBBUEkgQWRhcHRlciBhbGxvd3MgeW91IHRvIGNyZWF0ZSwgYWNjZXNzLCBhbmQgbWFuaXB1bGF0ZSBtdWx0aXBsYXllciB3b3JsZHMgd2l0aGluIHlvdXIgRXBpY2VudGVyIHByb2plY3QuIFlvdSBjYW4gdXNlIHRoaXMgdG8gYWRkIGFuZCByZW1vdmUgZW5kIHVzZXJzIGZyb20gdGhlIHdvcmxkLCBhbmQgdG8gY3JlYXRlLCBhY2Nlc3MsIGFuZCByZW1vdmUgdGhlaXIgcnVucy4gKFRoZSByZWxhdGVkIFtXb3JsZCBNYW5hZ2VyXSguLi93b3JsZC1tYW5hZ2VyLykgcHJvdmlkZXMgYW4gZWFzeSB3YXkgdG8gYWNjZXNzIHJ1bnMgYW5kIHdvcmxkcyBmb3IgcGFydGljdWxhciB1c2Vycy4pIE9ubHkgW3RlYW0gcHJvamVjdHNdKC4uLy4uLy4uL2dsb3NzYXJ5LyN0ZWFtKSBjYW4gYmUgbXVsdGlwbGF5ZXIuXG4gKlxuICogQXMgd2l0aCBhbGwgdGhlIG90aGVyIFtBUEkgQWRhcHRlcnNdKC4uLy4uLyksIGFsbCBtZXRob2RzIHRha2UgaW4gYW4gXCJvcHRpb25zXCIgb2JqZWN0IGFzIHRoZSBsYXN0IHBhcmFtZXRlci4gVGhlIG9wdGlvbnMgY2FuIGJlIHVzZWQgdG8gZXh0ZW5kL292ZXJyaWRlIHRoZSBXb3JsZCBBUEkgU2VydmljZSBkZWZhdWx0cy5cbiAqXG4gKiBUeXBpY2FsbHksIHlvdSBpbnN0YW50aWF0ZSBhIFdvcmxkIEFkYXB0ZXIgYW5kIHRoZW4gYWNjZXNzIHRoZSBtZXRob2RzIHByb3ZpZGVkLiBJbnN0YW50aWF0aW5nIHJlcXVpcmVzIHRoZSBhY2NvdW50IGlkICgqKlRlYW0gSUQqKiBpbiB0aGUgRXBpY2VudGVyIHVzZXIgaW50ZXJmYWNlKSwgcHJvamVjdCBpZCAoKipQcm9qZWN0IElEKiopLCBhbmQgZ3JvdXAgKCoqR3JvdXAgTmFtZSoqKS5cbiAqXG4gKiAgICAgICB2YXIgd2EgPSBuZXcgRi5zZXJ2aWNlLldvcmxkKHtcbiAqICAgICAgICAgIGFjY291bnQ6ICdhY21lLXNpbXVsYXRpb25zJyxcbiAqICAgICAgICAgIHByb2plY3Q6ICdzdXBwbHktY2hhaW4tZ2FtZScsXG4gKiAgICAgICAgICBncm91cDogJ3RlYW0xJyB9KTtcbiAqICAgICAgIHdhLmNyZWF0ZSgpXG4gKiAgICAgICAgICAudGhlbihmdW5jdGlvbih3b3JsZCkge1xuICogICAgICAgICAgICAgIC8vIGNhbGwgbWV0aG9kcywgZS5nLiB3YS5hZGRVc2VycygpXG4gKiAgICAgICAgICB9KTtcbiAqL1xuXG4ndXNlIHN0cmljdCc7XG5cbnZhciBDb25maWdTZXJ2aWNlID0gcmVxdWlyZSgnLi9jb25maWd1cmF0aW9uLXNlcnZpY2UnKTtcbnZhciBTdG9yYWdlRmFjdG9yeSA9IHJlcXVpcmUoJy4uL3N0b3JlL3N0b3JlLWZhY3RvcnknKTtcbi8vIHZhciBxdXRpbCA9IHJlcXVpcmUoJy4uL3V0aWwvcXVlcnktdXRpbCcpO1xudmFyIFRyYW5zcG9ydEZhY3RvcnkgPSByZXF1aXJlKCcuLi90cmFuc3BvcnQvaHR0cC10cmFuc3BvcnQtZmFjdG9yeScpO1xudmFyIF9waWNrID0gcmVxdWlyZSgnLi4vdXRpbC9vYmplY3QtdXRpbCcpLl9waWNrO1xuXG52YXIgYXBpQmFzZSA9ICdtdWx0aXBsYXllci8nO1xudmFyIGFzc2lnbm1lbnRFbmRwb2ludCA9IGFwaUJhc2UgKyAnYXNzaWduJztcbnZhciBhcGlFbmRwb2ludCA9IGFwaUJhc2UgKyAnd29ybGQnO1xudmFyIHByb2plY3RFbmRwb2ludCA9IGFwaUJhc2UgKyAncHJvamVjdCc7XG5cbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24gKGNvbmZpZykge1xuICAgIHZhciBzdG9yZSA9IG5ldyBTdG9yYWdlRmFjdG9yeSh7IHN5bmNocm9ub3VzOiB0cnVlIH0pO1xuXG4gICAgdmFyIGRlZmF1bHRzID0ge1xuICAgICAgICAvKipcbiAgICAgICAgICogRm9yIHByb2plY3RzIHRoYXQgcmVxdWlyZSBhdXRoZW50aWNhdGlvbiwgcGFzcyBpbiB0aGUgdXNlciBhY2Nlc3MgdG9rZW4gKGRlZmF1bHRzIHRvIGVtcHR5IHN0cmluZykuIElmIHRoZSB1c2VyIGlzIGFscmVhZHkgbG9nZ2VkIGluIHRvIEVwaWNlbnRlciwgdGhlIHVzZXIgYWNjZXNzIHRva2VuIGlzIGFscmVhZHkgc2V0IGluIGEgY29va2llIGFuZCBhdXRvbWF0aWNhbGx5IGxvYWRlZCBmcm9tIHRoZXJlLiAoU2VlIFttb3JlIGJhY2tncm91bmQgb24gYWNjZXNzIHRva2Vuc10oLi4vLi4vLi4vcHJvamVjdF9hY2Nlc3MvKSkuXG4gICAgICAgICAqIEBzZWUgW0F1dGhlbnRpY2F0aW9uIEFQSSBTZXJ2aWNlXSguLi9hdXRoLWFwaS1zZXJ2aWNlLykgZm9yIGdldHRpbmcgdG9rZW5zLlxuICAgICAgICAgKiBAdHlwZSB7U3RyaW5nfVxuICAgICAgICAgKi9cbiAgICAgICB0b2tlbjogc3RvcmUuZ2V0KCdlcGljZW50ZXIucHJvamVjdC50b2tlbicpIHx8ICcnLFxuXG4gICAgICAgIC8qKlxuICAgICAgICAgKiBUaGUgcHJvamVjdCBpZC4gRGVmYXVsdHMgdG8gdW5kZWZpbmVkLlxuICAgICAgICAgKiBAdHlwZSB7U3RyaW5nfVxuICAgICAgICAgKi9cbiAgICAgICBwcm9qZWN0OiB1bmRlZmluZWQsXG5cbiAgICAgICAgLyoqXG4gICAgICAgICAqIFRoZSBhY2NvdW50IGlkLiBJbiB0aGUgRXBpY2VudGVyIFVJLCB0aGlzIGlzIHRoZSAqKlRlYW0gSUQqKiAoZm9yIHRlYW0gcHJvamVjdHMpLiBEZWZhdWx0cyB0byB1bmRlZmluZWQuXG4gICAgICAgICAqIEB0eXBlIHtTdHJpbmd9XG4gICAgICAgICAqL1xuICAgICAgIGFjY291bnQ6IHVuZGVmaW5lZCxcblxuICAgICAgICAvKipcbiAgICAgICAgICogVGhlIGdyb3VwIG5hbWUuIERlZmF1bHRzIHRvIHVuZGVmaW5lZC5cbiAgICAgICAgICogQHR5cGUge1N0cmluZ31cbiAgICAgICAgICovXG4gICAgICAgZ3JvdXA6IHVuZGVmaW5lZCxcblxuICAgICAgIC8qKlxuICAgICAgICAgKiBUaGUgbW9kZWwgZmlsZSB0byB1c2UgdG8gY3JlYXRlIHJ1bnMgaW4gdGhpcyB3b3JsZC4gRGVmYXVsdHMgdG8gdW5kZWZpbmVkLlxuICAgICAgICAgKiBAdHlwZSB7U3RyaW5nfVxuICAgICAgICAgKi9cbiAgICAgICAgbW9kZWw6IHVuZGVmaW5lZCxcblxuLy8gICAgICAgIGFwaUtleTogJycsXG5cbi8vICAgICAgICBkb21haW46ICdmb3Jpby5jb20nLFxuXG4gICAgICAgIC8qKlxuICAgICAgICAgKiBPcHRpb25zIHRvIHBhc3Mgb24gdG8gdGhlIHVuZGVybHlpbmcgdHJhbnNwb3J0IGxheWVyLiBBbGwganF1ZXJ5LmFqYXggb3B0aW9ucyBhdCBodHRwOi8vYXBpLmpxdWVyeS5jb20valF1ZXJ5LmFqYXgvIGFyZSBhdmFpbGFibGUuIERlZmF1bHRzIHRvIGVtcHR5IG9iamVjdC5cbiAgICAgICAgICogQHR5cGUge09iamVjdH1cbiAgICAgICAgICovXG4gICAgICAgIHRyYW5zcG9ydDoge30sXG5cbiAgICAgICAgLyoqXG4gICAgICAgICAqIENhbGxlZCB3aGVuIHRoZSBjYWxsIGNvbXBsZXRlcyBzdWNjZXNzZnVsbHkuIERlZmF1bHRzIHRvIGAkLm5vb3BgLlxuICAgICAgICAgKi9cbiAgICAgICAgc3VjY2VzczogJC5ub29wLFxuXG4gICAgICAgIC8qKlxuICAgICAgICAgKiBDYWxsZWQgd2hlbiB0aGUgY2FsbCBmYWlscy4gRGVmYXVsdHMgdG8gYCQubm9vcGAuXG4gICAgICAgICAqL1xuICAgICAgICBlcnJvcjogJC5ub29wXG4gICAgfTtcblxuICAgIHZhciBzZXJ2aWNlT3B0aW9ucyA9ICQuZXh0ZW5kKHt9LCBkZWZhdWx0cywgY29uZmlnKTtcbiAgICB2YXIgdXJsQ29uZmlnID0gbmV3IENvbmZpZ1NlcnZpY2Uoc2VydmljZU9wdGlvbnMpLmdldCgnc2VydmVyJyk7XG5cbiAgICBpZiAoIXNlcnZpY2VPcHRpb25zLmFjY291bnQpIHtcbiAgICAgICAgc2VydmljZU9wdGlvbnMuYWNjb3VudCA9IHVybENvbmZpZy5hY2NvdW50UGF0aDtcbiAgICB9XG5cbiAgICBpZiAoIXNlcnZpY2VPcHRpb25zLnByb2plY3QpIHtcbiAgICAgICAgc2VydmljZU9wdGlvbnMucHJvamVjdCA9IHVybENvbmZpZy5wcm9qZWN0UGF0aDtcbiAgICB9XG5cbiAgICB2YXIgdHJhbnNwb3J0T3B0aW9ucyA9ICQuZXh0ZW5kKHRydWUsIHt9LCBzZXJ2aWNlT3B0aW9ucy50cmFuc3BvcnQsIHtcbiAgICAgICAgdXJsOiB1cmxDb25maWcuZ2V0QVBJUGF0aChhcGlFbmRwb2ludClcbiAgICB9KTtcblxuICAgIGlmIChzZXJ2aWNlT3B0aW9ucy50b2tlbikge1xuICAgICAgICB0cmFuc3BvcnRPcHRpb25zLmhlYWRlcnMgPSB7XG4gICAgICAgICAgICAnQXV0aG9yaXphdGlvbic6ICdCZWFyZXIgJyArIHNlcnZpY2VPcHRpb25zLnRva2VuXG4gICAgICAgIH07XG4gICAgfVxuXG4gICAgdmFyIGh0dHAgPSBuZXcgVHJhbnNwb3J0RmFjdG9yeSh0cmFuc3BvcnRPcHRpb25zKTtcblxuICAgIHZhciBzZXRJZEZpbHRlck9yVGhyb3dFcnJvciA9IGZ1bmN0aW9uIChvcHRpb25zKSB7XG4gICAgICAgIGlmIChvcHRpb25zLmZpbHRlcikge1xuICAgICAgICAgICAgc2VydmljZU9wdGlvbnMuZmlsdGVyID0gb3B0aW9ucy5maWx0ZXI7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKCFzZXJ2aWNlT3B0aW9ucy5maWx0ZXIpIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcignTm8gZmlsdGVyIHNwZWNpZmllZCB0byBhcHBseSBvcGVyYXRpb25zIGFnYWluc3QnKTtcbiAgICAgICAgfVxuICAgIH07XG5cbiAgICB2YXIgdmFsaWRhdGVNb2RlbE9yVGhyb3dFcnJvciA9IGZ1bmN0aW9uIChvcHRpb25zKSB7XG4gICAgICAgIGlmICghb3B0aW9ucy5tb2RlbCkge1xuICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdObyBtb2RlbCBzcGVjaWZpZWQgdG8gZ2V0IHRoZSBjdXJyZW50IHJ1bicpO1xuICAgICAgICB9XG4gICAgfTtcblxuICAgIHZhciBwdWJsaWNBUEkgPSB7XG5cbiAgICAgICAgLyoqXG4gICAgICAgICogQ3JlYXRlIGEgbmV3IFdvcmxkLlxuICAgICAgICAqXG4gICAgICAgICogICoqRXhhbXBsZSoqXG4gICAgICAgICpcbiAgICAgICAgKiAgICAgIHZhciB3YSA9IG5ldyBGLnNlcnZpY2UuV29ybGQoe1xuICAgICAgICAqICAgICAgICAgICBhY2NvdW50OiAnYWNtZS1zaW11bGF0aW9ucycsXG4gICAgICAgICogICAgICAgICAgIHByb2plY3Q6ICdzdXBwbHktY2hhaW4tZ2FtZScsXG4gICAgICAgICogICAgICAgICAgIGdyb3VwOiAndGVhbTEnIH0pO1xuICAgICAgICAqICAgICAgd2EuY3JlYXRlKHtcbiAgICAgICAgKiAgICAgICAgICAgcm9sZXM6IFsnVlAgTWFya2V0aW5nJywgJ1ZQIFNhbGVzJywgJ1ZQIEVuZ2luZWVyaW5nJ11cbiAgICAgICAgKiAgICAgICB9KTtcbiAgICAgICAgKlxuICAgICAgICAqICAqKlBhcmFtZXRlcnMqKlxuICAgICAgICAqIEBwYXJhbSB7b2JqZWN0fSBgcGFyYW1zYCBQYXJhbWV0ZXJzIHRvIGNyZWF0ZSB0aGUgd29ybGQuXG4gICAgICAgICogQHBhcmFtIHtzdHJpbmd9IGBwYXJhbXMuZ3JvdXBgIChPcHRpb25hbCkgVGhlICoqR3JvdXAgTmFtZSoqIHRvIGNyZWF0ZSB0aGlzIHdvcmxkIHVuZGVyLiBPbmx5IGVuZCB1c2VycyBpbiB0aGlzIGdyb3VwIGFyZSBlbGlnaWJsZSB0byBqb2luIHRoZSB3b3JsZC4gT3B0aW9uYWwgaGVyZTsgcmVxdWlyZWQgd2hlbiBpbnN0YW50aWF0aW5nIHRoZSBzZXJ2aWNlIChuZXcgRi5zZXJ2aWNlLldvcmxkKCkpLlxuICAgICAgICAqIEBwYXJhbSB7b2JqZWN0fSBgcGFyYW1zLnJvbGVzYCAoT3B0aW9uYWwpIFRoZSBsaXN0IG9mIHJvbGVzIChzdHJpbmdzKSBmb3IgdGhpcyB3b3JsZC4gU29tZSB3b3JsZHMgaGF2ZSBzcGVjaWZpYyByb2xlcyB0aGF0ICoqbXVzdCoqIGJlIGZpbGxlZCBieSBlbmQgdXNlcnMuIExpc3RpbmcgdGhlIHJvbGVzIGFsbG93cyB5b3UgdG8gYXV0b2Fzc2lnbiB1c2VycyB0byB3b3JsZHMgYW5kIGVuc3VyZSB0aGF0IGFsbCByb2xlcyBhcmUgZmlsbGVkIGluIGVhY2ggd29ybGQuXG4gICAgICAgICogQHBhcmFtIHtvYmplY3R9IGBwYXJhbXMub3B0aW9uYWxSb2xlc2AgKE9wdGlvbmFsKSBUaGUgbGlzdCBvZiBvcHRpb25hbCByb2xlcyAoc3RyaW5ncykgZm9yIHRoaXMgd29ybGQuIFNvbWUgd29ybGRzIGhhdmUgc3BlY2lmaWMgcm9sZXMgdGhhdCAqKm1heSoqIGJlIGZpbGxlZCBieSBlbmQgdXNlcnMuIExpc3RpbmcgdGhlIG9wdGlvbmFsIHJvbGVzIGFzIHBhcnQgb2YgdGhlIHdvcmxkIG9iamVjdCBhbGxvd3MgeW91IHRvIGF1dG9hc3NpZ24gdXNlcnMgdG8gd29ybGRzIGFuZCBlbnN1cmUgdGhhdCBhbGwgcm9sZXMgYXJlIGZpbGxlZCBpbiBlYWNoIHdvcmxkLlxuICAgICAgICAqIEBwYXJhbSB7aW50ZWdlcn0gYHBhcmFtcy5taW5Vc2Vyc2AgKE9wdGlvbmFsKSBUaGUgbWluaW11bSBudW1iZXIgb2YgdXNlcnMgZm9yIHRoZSB3b3JsZC4gSW5jbHVkaW5nIHRoaXMgbnVtYmVyIGFsbG93cyB5b3UgdG8gYXV0b2Fzc2lnbiBlbmQgdXNlcnMgdG8gd29ybGRzIGFuZCBlbnN1cmUgdGhhdCB0aGUgY29ycmVjdCBudW1iZXIgb2YgdXNlcnMgYXJlIGluIGVhY2ggd29ybGQuXG4gICAgICAgICogQHBhcmFtIHtvYmplY3R9IGBvcHRpb25zYCAoT3B0aW9uYWwpIE9wdGlvbnMgb2JqZWN0IHRvIG92ZXJyaWRlIGdsb2JhbCBvcHRpb25zLlxuICAgICAgICAqXG4gICAgICAgICovXG4gICAgICAgIGNyZWF0ZTogZnVuY3Rpb24gKHBhcmFtcywgb3B0aW9ucykge1xuICAgICAgICAgICAgdmFyIGNyZWF0ZU9wdGlvbnMgPSAkLmV4dGVuZCh0cnVlLCB7fSwgc2VydmljZU9wdGlvbnMsIG9wdGlvbnMsIHsgdXJsOiB1cmxDb25maWcuZ2V0QVBJUGF0aChhcGlFbmRwb2ludCkgfSk7XG4gICAgICAgICAgICB2YXIgd29ybGRBcGlQYXJhbXMgPSBbJ3Njb3BlJywgJ2ZpbGVzJywgJ3JvbGVzJywgJ29wdGlvbmFsUm9sZXMnLCAnbWluVXNlcnMnLCAnZ3JvdXAnLCAnbmFtZSddO1xuICAgICAgICAgICAgLy8gd2hpdGVsaXN0IHRoZSBmaWVsZHMgdGhhdCB3ZSBhY3R1YWxseSBjYW4gc2VuZCB0byB0aGUgYXBpXG4gICAgICAgICAgICBwYXJhbXMgPSBfcGljayhwYXJhbXMsIHdvcmxkQXBpUGFyYW1zKTtcblxuICAgICAgICAgICAgLy8gYWNjb3VudCBhbmQgcHJvamVjdCBnbyBpbiB0aGUgYm9keSwgbm90IGluIHRoZSB1cmxcbiAgICAgICAgICAgICQuZXh0ZW5kKHBhcmFtcywgX3BpY2soc2VydmljZU9wdGlvbnMsIFsnYWNjb3VudCcsICdwcm9qZWN0JywgJ2dyb3VwJ10pKTtcblxuICAgICAgICAgICAgdmFyIG9sZFN1Y2Nlc3MgPSBjcmVhdGVPcHRpb25zLnN1Y2Nlc3M7XG4gICAgICAgICAgICBjcmVhdGVPcHRpb25zLnN1Y2Nlc3MgPSBmdW5jdGlvbiAocmVzcG9uc2UpIHtcbiAgICAgICAgICAgICAgICBzZXJ2aWNlT3B0aW9ucy5maWx0ZXIgPSByZXNwb25zZS5pZDsgLy9hbGwgZnV0dXJlIGNoYWluZWQgY2FsbHMgdG8gb3BlcmF0ZSBvbiB0aGlzIGlkXG4gICAgICAgICAgICAgICAgcmV0dXJuIG9sZFN1Y2Nlc3MuYXBwbHkodGhpcywgYXJndW1lbnRzKTtcbiAgICAgICAgICAgIH07XG5cbiAgICAgICAgICAgIHJldHVybiBodHRwLnBvc3QocGFyYW1zLCBjcmVhdGVPcHRpb25zKTtcbiAgICAgICAgfSxcblxuICAgICAgICAvKipcbiAgICAgICAgKiBVcGRhdGUgYSBXb3JsZCwgZm9yIGV4YW1wbGUgdG8gYWRkIHRoZSByb2xlcyB0byB0aGUgd29ybGQuXG4gICAgICAgICpcbiAgICAgICAgKiAgKipFeGFtcGxlKipcbiAgICAgICAgKlxuICAgICAgICAqICAgICAgdmFyIHdhID0gbmV3IEYuc2VydmljZS5Xb3JsZCh7XG4gICAgICAgICogICAgICAgICAgIGFjY291bnQ6ICdhY21lLXNpbXVsYXRpb25zJyxcbiAgICAgICAgKiAgICAgICAgICAgcHJvamVjdDogJ3N1cHBseS1jaGFpbi1nYW1lJyxcbiAgICAgICAgKiAgICAgICAgICAgZ3JvdXA6ICd0ZWFtMScgfSk7XG4gICAgICAgICogICAgICB3YS5jcmVhdGUoKTtcbiAgICAgICAgKiAgICAgICAgICAgLnRoZW4oZnVuY3Rpb24od29ybGQpIHtcbiAgICAgICAgKiAgICAgICAgICAgICAgIHdhLnVwZGF0ZSh7IHJvbGVzOiBbJ1ZQIE1hcmtldGluZycsICdWUCBTYWxlcycsICdWUCBFbmdpbmVlcmluZyddIH0pO1xuICAgICAgICAqICAgICAgICAgICB9KTtcbiAgICAgICAgKlxuICAgICAgICAqICAqKlBhcmFtZXRlcnMqKlxuICAgICAgICAqIEBwYXJhbSB7b2JqZWN0fSBgcGFyYW1zYCBQYXJhbWV0ZXJzIHRvIHVwZGF0ZSB0aGUgd29ybGQuXG4gICAgICAgICogQHBhcmFtIHtzdHJpbmd9IGBwYXJhbXMubmFtZWAgQSBzdHJpbmcgaWRlbnRpZmllciBmb3IgdGhlIGxpbmtlZCBlbmQgdXNlcnMsIGZvciBleGFtcGxlLCBcIm5hbWVcIjogXCJPdXIgVGVhbVwiLlxuICAgICAgICAqIEBwYXJhbSB7b2JqZWN0fSBgcGFyYW1zLnJvbGVzYCAoT3B0aW9uYWwpIFRoZSBsaXN0IG9mIHJvbGVzIChzdHJpbmdzKSBmb3IgdGhpcyB3b3JsZC4gU29tZSB3b3JsZHMgaGF2ZSBzcGVjaWZpYyByb2xlcyB0aGF0ICoqbXVzdCoqIGJlIGZpbGxlZCBieSBlbmQgdXNlcnMuIExpc3RpbmcgdGhlIHJvbGVzIGFsbG93cyB5b3UgdG8gYXV0b2Fzc2lnbiB1c2VycyB0byB3b3JsZHMgYW5kIGVuc3VyZSB0aGF0IGFsbCByb2xlcyBhcmUgZmlsbGVkIGluIGVhY2ggd29ybGQuXG4gICAgICAgICogQHBhcmFtIHtvYmplY3R9IGBwYXJhbXMub3B0aW9uYWxSb2xlc2AgKE9wdGlvbmFsKSBUaGUgbGlzdCBvZiBvcHRpb25hbCByb2xlcyAoc3RyaW5ncykgZm9yIHRoaXMgd29ybGQuIFNvbWUgd29ybGRzIGhhdmUgc3BlY2lmaWMgcm9sZXMgdGhhdCAqKm1heSoqIGJlIGZpbGxlZCBieSBlbmQgdXNlcnMuIExpc3RpbmcgdGhlIG9wdGlvbmFsIHJvbGVzIGFzIHBhcnQgb2YgdGhlIHdvcmxkIG9iamVjdCBhbGxvd3MgeW91IHRvIGF1dG9hc3NpZ24gdXNlcnMgdG8gd29ybGRzIGFuZCBlbnN1cmUgdGhhdCBhbGwgcm9sZXMgYXJlIGZpbGxlZCBpbiBlYWNoIHdvcmxkLlxuICAgICAgICAqIEBwYXJhbSB7aW50ZWdlcn0gYHBhcmFtcy5taW5Vc2Vyc2AgKE9wdGlvbmFsKSBUaGUgbWluaW11bSBudW1iZXIgb2YgdXNlcnMgZm9yIHRoZSB3b3JsZC4gSW5jbHVkaW5nIHRoaXMgbnVtYmVyIGFsbG93cyB5b3UgdG8gYXV0b2Fzc2lnbiBlbmQgdXNlcnMgdG8gd29ybGRzIGFuZCBlbnN1cmUgdGhhdCB0aGUgY29ycmVjdCBudW1iZXIgb2YgdXNlcnMgYXJlIGluIGVhY2ggd29ybGQuXG4gICAgICAgICogQHBhcmFtIHtvYmplY3R9IGBvcHRpb25zYCAoT3B0aW9uYWwpIE9wdGlvbnMgb2JqZWN0IHRvIG92ZXJyaWRlIGdsb2JhbCBvcHRpb25zLlxuICAgICAgICAqXG4gICAgICAgICovXG4gICAgICAgIHVwZGF0ZTogZnVuY3Rpb24gKHBhcmFtcywgb3B0aW9ucykge1xuICAgICAgICAgICAgdmFyIHdoaXRlbGlzdCA9IFsncm9sZXMnLCAnb3B0aW9uYWxSb2xlcycsICdtaW5Vc2VycyddO1xuICAgICAgICAgICAgb3B0aW9ucyA9IG9wdGlvbnMgfHwge307XG4gICAgICAgICAgICBzZXRJZEZpbHRlck9yVGhyb3dFcnJvcihvcHRpb25zKTtcblxuICAgICAgICAgICAgdmFyIHVwZGF0ZU9wdGlvbnMgPSAkLmV4dGVuZCh0cnVlLCB7fSxcbiAgICAgICAgICAgICAgICBzZXJ2aWNlT3B0aW9ucyxcbiAgICAgICAgICAgICAgICBvcHRpb25zLFxuICAgICAgICAgICAgICAgIHsgdXJsOiB1cmxDb25maWcuZ2V0QVBJUGF0aChhcGlFbmRwb2ludCkgKyBzZXJ2aWNlT3B0aW9ucy5maWx0ZXIgfVxuICAgICAgICAgICAgKTtcblxuICAgICAgICAgICAgcGFyYW1zID0gX3BpY2socGFyYW1zIHx8IHt9LCB3aGl0ZWxpc3QpO1xuXG4gICAgICAgICAgICByZXR1cm4gaHR0cC5wYXRjaChwYXJhbXMsIHVwZGF0ZU9wdGlvbnMpO1xuICAgICAgICB9LFxuXG4gICAgICAgIC8qKlxuICAgICAgICAqIERlbGV0ZSBhbiBleGlzdGluZyB3b3JsZC5cbiAgICAgICAgKlxuICAgICAgICAqICAqKkV4YW1wbGUqKlxuICAgICAgICAqXG4gICAgICAgICogICAgICB2YXIgd2EgPSBuZXcgRi5zZXJ2aWNlLldvcmxkKHtcbiAgICAgICAgKiAgICAgICAgICAgYWNjb3VudDogJ2FjbWUtc2ltdWxhdGlvbnMnLFxuICAgICAgICAqICAgICAgICAgICBwcm9qZWN0OiAnc3VwcGx5LWNoYWluLWdhbWUnLFxuICAgICAgICAqICAgICAgICAgICBncm91cDogJ3RlYW0xJyB9KTtcbiAgICAgICAgKiAgICAgIHdhLmNyZWF0ZSgpO1xuICAgICAgICAqICAgICAgICAgICAudGhlbihmdW5jdGlvbih3b3JsZCkge1xuICAgICAgICAqICAgICAgICAgICAgICAgd2EuZGVsZXRlKCk7XG4gICAgICAgICogICAgICAgICAgIH0pO1xuICAgICAgICAqXG4gICAgICAgICogICoqUGFyYW1ldGVycyoqXG4gICAgICAgICogQHBhcmFtIHtvYmplY3R9IGBvcHRpb25zYCAoT3B0aW9uYWwpIE9wdGlvbnMgb2JqZWN0IHRvIG92ZXJyaWRlIGdsb2JhbCBvcHRpb25zLlxuICAgICAgICAqXG4gICAgICAgICovXG4gICAgICAgIGRlbGV0ZTogZnVuY3Rpb24gKG9wdGlvbnMpIHtcbiAgICAgICAgICAgIG9wdGlvbnMgPSBvcHRpb25zIHx8IHt9O1xuICAgICAgICAgICAgc2V0SWRGaWx0ZXJPclRocm93RXJyb3Iob3B0aW9ucyk7XG5cbiAgICAgICAgICAgIHZhciBkZWxldGVPcHRpb25zID0gJC5leHRlbmQodHJ1ZSwge30sXG4gICAgICAgICAgICAgICAgc2VydmljZU9wdGlvbnMsXG4gICAgICAgICAgICAgICAgb3B0aW9ucyxcbiAgICAgICAgICAgICAgICB7IHVybDogdXJsQ29uZmlnLmdldEFQSVBhdGgoYXBpRW5kcG9pbnQpICsgc2VydmljZU9wdGlvbnMuZmlsdGVyIH1cbiAgICAgICAgICAgICk7XG5cbiAgICAgICAgICAgIHJldHVybiBodHRwLmRlbGV0ZShudWxsLCBkZWxldGVPcHRpb25zKTtcbiAgICAgICAgfSxcblxuICAgICAgICAvKipcbiAgICAgICAgKiBVcGRhdGVzIHRoZSBjb25maWd1cmF0aW9uIGZvciB0aGUgY3VycmVudCBpbnN0YW5jZSBvZiB0aGUgd29ybGQgYWRhcHRlclxuICAgICAgICAqXG4gICAgICAgICogKipFeGFtcGxlKipcbiAgICAgICAgKiB2YXIgd3MgPSBuZXcgRi5zZXJ2aWNlLldvcmxkKHsuLi59KS51cGRhdGVDb25maWcoeyBmaWx0ZXI6ICcxMjMnIH0pLmFkZFVzZXIoeyB1c2VySWQ6ICcxMjMnIH0pO1xuICAgICAgICAqXG4gICAgICAgICpcbiAgICAgICAgKi9cbiAgICAgICAgdXBkYXRlQ29uZmlnOiBmdW5jdGlvbiAoY29uZmlnKSB7XG4gICAgICAgICAgICAkLmV4dGVuZChzZXJ2aWNlT3B0aW9ucywgY29uZmlnKTtcblxuICAgICAgICAgICAgcmV0dXJuIHRoaXM7XG4gICAgICAgIH0sXG5cbiAgICAgICAgLyoqXG4gICAgICAgICogTGlzdCBhbGwgd29ybGRzIGZvciBhIGdpdmVuIGFjY291bnQsIHByb2plY3QsIGFuZCBncm91cC4gQWxsIHRocmVlIGFyZSByZXF1aXJlZCwgYW5kIGlmIG5vdCBzcGVjaWZpZWQgYXMgcGFyYW1ldGVycywgYXJlIHJlYWQgZnJvbSB0aGUgc2VydmljZS5cbiAgICAgICAgKlxuICAgICAgICAqICAqKkV4YW1wbGUqKlxuICAgICAgICAqXG4gICAgICAgICogICAgICB2YXIgd2EgPSBuZXcgRi5zZXJ2aWNlLldvcmxkKHtcbiAgICAgICAgKiAgICAgICAgICAgYWNjb3VudDogJ2FjbWUtc2ltdWxhdGlvbnMnLFxuICAgICAgICAqICAgICAgICAgICBwcm9qZWN0OiAnc3VwcGx5LWNoYWluLWdhbWUnLFxuICAgICAgICAqICAgICAgICAgICBncm91cDogJ3RlYW0xJyB9KTtcbiAgICAgICAgKiAgICAgIHdhLmNyZWF0ZSgpO1xuICAgICAgICAqICAgICAgICAgICAudGhlbihmdW5jdGlvbih3b3JsZCkge1xuICAgICAgICAqICAgICAgICAgICAgICAgLy8gbGlzdHMgYWxsIHdvcmxkcyBpbiBncm91cCBcInRlYW0xXCJcbiAgICAgICAgKiAgICAgICAgICAgICAgIHdhLmxpc3QoKTtcbiAgICAgICAgKlxuICAgICAgICAqICAgICAgICAgICAgICAgLy8gbGlzdHMgYWxsIHdvcmxkcyBpbiBncm91cCBcIm90aGVyLWdyb3VwLW5hbWVcIlxuICAgICAgICAqICAgICAgICAgICAgICAgd2EubGlzdCh7IGdyb3VwOiAnb3RoZXItZ3JvdXAtbmFtZScgfSk7XG4gICAgICAgICogICAgICAgICAgIH0pO1xuICAgICAgICAqXG4gICAgICAgICogICoqUGFyYW1ldGVycyoqXG4gICAgICAgICogQHBhcmFtIHtvYmplY3R9IGBvcHRpb25zYCAoT3B0aW9uYWwpIE9wdGlvbnMgb2JqZWN0IHRvIG92ZXJyaWRlIGdsb2JhbCBvcHRpb25zLlxuICAgICAgICAqXG4gICAgICAgICovXG4gICAgICAgIGxpc3Q6IGZ1bmN0aW9uIChvcHRpb25zKSB7XG4gICAgICAgICAgICBvcHRpb25zID0gb3B0aW9ucyB8fCB7fTtcblxuICAgICAgICAgICAgdmFyIGdldE9wdGlvbnMgPSAkLmV4dGVuZCh0cnVlLCB7fSxcbiAgICAgICAgICAgICAgICBzZXJ2aWNlT3B0aW9ucyxcbiAgICAgICAgICAgICAgICBvcHRpb25zLFxuICAgICAgICAgICAgICAgIHsgdXJsOiB1cmxDb25maWcuZ2V0QVBJUGF0aChhcGlFbmRwb2ludCkgfVxuICAgICAgICAgICAgKTtcblxuICAgICAgICAgICAgdmFyIGZpbHRlcnMgPSBfcGljayhnZXRPcHRpb25zLCBbJ2FjY291bnQnLCAncHJvamVjdCcsICdncm91cCddKTtcblxuICAgICAgICAgICAgcmV0dXJuIGh0dHAuZ2V0KGZpbHRlcnMsIGdldE9wdGlvbnMpO1xuICAgICAgICB9LFxuXG4gICAgICAgIC8qKlxuICAgICAgICAqIEdldCBhbGwgd29ybGRzIHRoYXQgYW4gZW5kIHVzZXIgYmVsb25ncyB0byBmb3IgYSBnaXZlbiBhY2NvdW50LCBwcm9qZWN0LCBhbmQgZ3JvdXAuXG4gICAgICAgICpcbiAgICAgICAgKiAgKipFeGFtcGxlKipcbiAgICAgICAgKlxuICAgICAgICAqICAgICAgdmFyIHdhID0gbmV3IEYuc2VydmljZS5Xb3JsZCh7XG4gICAgICAgICogICAgICAgICAgIGFjY291bnQ6ICdhY21lLXNpbXVsYXRpb25zJyxcbiAgICAgICAgKiAgICAgICAgICAgcHJvamVjdDogJ3N1cHBseS1jaGFpbi1nYW1lJyxcbiAgICAgICAgKiAgICAgICAgICAgZ3JvdXA6ICd0ZWFtMScgfSk7XG4gICAgICAgICogICAgICB3YS5jcmVhdGUoKTtcbiAgICAgICAgKiAgICAgICAgICAgLnRoZW4oZnVuY3Rpb24od29ybGQpIHtcbiAgICAgICAgKiAgICAgICAgICAgICAgIHdhLmdldFdvcmxkc0ZvclVzZXIoJ2IxYzE5ZGRhLTJkMmUtNDc3Ny1hZDVkLTM5MjlmMTdlODZkMycpXG4gICAgICAgICogICAgICAgICAgIH0pO1xuICAgICAgICAqXG4gICAgICAgICogKiogUGFyYW1ldGVycyAqKlxuICAgICAgICAqIEBwYXJhbSB7c3RyaW5nfSBgdXNlcklkYCBUaGUgYHVzZXJJZGAgb2YgdGhlIHVzZXIgd2hvc2Ugd29ybGRzIGFyZSBiZWluZyByZXRyaWV2ZWQuXG4gICAgICAgICogQHBhcmFtIHtvYmplY3R9IGBvcHRpb25zYCAoT3B0aW9uYWwpIE9wdGlvbnMgb2JqZWN0IHRvIG92ZXJyaWRlIGdsb2JhbCBvcHRpb25zLlxuICAgICAgICAqL1xuICAgICAgICBnZXRXb3JsZHNGb3JVc2VyOiBmdW5jdGlvbiAodXNlcklkLCBvcHRpb25zKSB7XG4gICAgICAgICAgICBvcHRpb25zID0gb3B0aW9ucyB8fCB7fTtcblxuICAgICAgICAgICAgdmFyIGdldE9wdGlvbnMgPSAkLmV4dGVuZCh0cnVlLCB7fSxcbiAgICAgICAgICAgICAgICBzZXJ2aWNlT3B0aW9ucyxcbiAgICAgICAgICAgICAgICBvcHRpb25zLFxuICAgICAgICAgICAgICAgIHsgdXJsOiB1cmxDb25maWcuZ2V0QVBJUGF0aChhcGlFbmRwb2ludCkgfVxuICAgICAgICAgICAgKTtcblxuICAgICAgICAgICAgdmFyIGZpbHRlcnMgPSAkLmV4dGVuZChcbiAgICAgICAgICAgICAgICBfcGljayhnZXRPcHRpb25zLCBbJ2FjY291bnQnLCAncHJvamVjdCcsICdncm91cCddKSxcbiAgICAgICAgICAgICAgICB7IHVzZXJJZDogdXNlcklkIH1cbiAgICAgICAgICAgICk7XG5cbiAgICAgICAgICAgIHJldHVybiBodHRwLmdldChmaWx0ZXJzLCBnZXRPcHRpb25zKTtcbiAgICAgICAgfSxcblxuICAgICAgICAvKipcbiAgICAgICAgKiBBZGQgYW4gZW5kIHVzZXIgb3IgbGlzdCBvZiBlbmQgdXNlcnMgdG8gYSBnaXZlbiB3b3JsZC4gVGhlIGVuZCB1c2VyIG11c3QgYmUgYSBtZW1iZXIgb2YgdGhlIGBncm91cGAgdGhhdCBpcyBhc3NvY2lhdGVkIHdpdGggdGhpcyB3b3JsZC5cbiAgICAgICAgKlxuICAgICAgICAqICAqKkV4YW1wbGUqKlxuICAgICAgICAqXG4gICAgICAgICogICAgICB2YXIgd2EgPSBuZXcgRi5zZXJ2aWNlLldvcmxkKHtcbiAgICAgICAgKiAgICAgICAgICAgYWNjb3VudDogJ2FjbWUtc2ltdWxhdGlvbnMnLFxuICAgICAgICAqICAgICAgICAgICBwcm9qZWN0OiAnc3VwcGx5LWNoYWluLWdhbWUnLFxuICAgICAgICAqICAgICAgICAgICBncm91cDogJ3RlYW0xJyB9KTtcbiAgICAgICAgKiAgICAgIHdhLmNyZWF0ZSgpO1xuICAgICAgICAqICAgICAgICAgICAudGhlbihmdW5jdGlvbih3b3JsZCkge1xuICAgICAgICAqICAgICAgICAgICAgICAgLy8gYWRkIG9uZSB1c2VyXG4gICAgICAgICogICAgICAgICAgICAgICB3YS5hZGRVc2VycygnYjFjMTlkZGEtMmQyZS00Nzc3LWFkNWQtMzkyOWYxN2U4NmQzJyk7XG4gICAgICAgICogICAgICAgICAgICAgICB3YS5hZGRVc2VycyhbJ2IxYzE5ZGRhLTJkMmUtNDc3Ny1hZDVkLTM5MjlmMTdlODZkMyddKTtcbiAgICAgICAgKiAgICAgICAgICAgICAgIHdhLmFkZFVzZXJzKHsgdXNlcklkOiAnYjFjMTlkZGEtMmQyZS00Nzc3LWFkNWQtMzkyOWYxN2U4NmQzJywgcm9sZTogJ1ZQIFNhbGVzJyB9KTtcbiAgICAgICAgKlxuICAgICAgICAqICAgICAgICAgICAgICAgLy8gYWRkIHNldmVyYWwgdXNlcnNcbiAgICAgICAgKiAgICAgICAgICAgICAgIHdhLmFkZFVzZXJzKFtcbiAgICAgICAgKiAgICAgICAgICAgICAgICAgICB7IHVzZXJJZDogJ2E2ZmUwYzFlLWY0YjgtNGYwMS05ZjVmLTAxY2NmNGMyZWQ0NCcsXG4gICAgICAgICogICAgICAgICAgICAgICAgICAgICByb2xlOiAnVlAgTWFya2V0aW5nJyB9LFxuICAgICAgICAqICAgICAgICAgICAgICAgICAgIHsgdXNlcklkOiAnOGYyNjA0Y2YtOTZjZC00NDlmLTgyZmEtZTMzMTUzMDczNGVlJyxcbiAgICAgICAgKiAgICAgICAgICAgICAgICAgICAgIHJvbGU6ICdWUCBFbmdpbmVlcmluZycgfVxuICAgICAgICAqICAgICAgICAgICAgICAgXSk7XG4gICAgICAgICpcbiAgICAgICAgKiAgICAgICAgICAgICAgIC8vIGFkZCBvbmUgdXNlciB0byBhIHNwZWNpZmljIHdvcmxkXG4gICAgICAgICogICAgICAgICAgICAgICB3YS5hZGRVc2VycygnYjFjMTlkZGEtMmQyZS00Nzc3LWFkNWQtMzkyOWYxN2U4NmQzJywgd29ybGQuaWQpO1xuICAgICAgICAqICAgICAgICAgICAgICAgd2EuYWRkVXNlcnMoJ2IxYzE5ZGRhLTJkMmUtNDc3Ny1hZDVkLTM5MjlmMTdlODZkMycsIHsgZmlsdGVyOiB3b3JsZC5pZCB9KTtcbiAgICAgICAgKiAgICAgICAgICAgfSk7XG4gICAgICAgICpcbiAgICAgICAgKiAqKiBQYXJhbWV0ZXJzICoqXG4gICAgICAgICogQHBhcmFtIHtzdHJpbmd8b2JqZWN0fGFycmF5fSBgdXNlcnNgIFVzZXIgaWQsIGFycmF5IG9mIHVzZXIgaWRzLCBvYmplY3QsIG9yIGFycmF5IG9mIG9iamVjdHMgb2YgdGhlIHVzZXJzIHRvIGFkZCB0byB0aGlzIHdvcmxkLlxuICAgICAgICAqIEBwYXJhbSB7c3RyaW5nfSBgdXNlcnMucm9sZWAgVGhlIGByb2xlYCB0aGUgdXNlciBzaG91bGQgaGF2ZSBpbiB0aGUgd29ybGQuIEl0IGlzIHVwIHRvIHRoZSBjYWxsZXIgdG8gZW5zdXJlLCBpZiBuZWVkZWQsIHRoYXQgdGhlIGByb2xlYCBwYXNzZWQgaW4gaXMgb25lIG9mIHRoZSBgcm9sZXNgIG9yIGBvcHRpb25hbFJvbGVzYCBvZiB0aGlzIHdvcmxkLlxuICAgICAgICAqIEBwYXJhbSB7c3RyaW5nfSBgd29ybGRJZGAgVGhlIHdvcmxkIHRvIHdoaWNoIHRoZSB1c2VycyBzaG91bGQgYmUgYWRkZWQuIElmIG5vdCBzcGVjaWZpZWQsIHRoZSBmaWx0ZXIgcGFyYW1ldGVyIG9mIHRoZSBgb3B0aW9uc2Agb2JqZWN0IGlzIHVzZWQuXG4gICAgICAgICogQHBhcmFtIHtvYmplY3R9IGBvcHRpb25zYCAoT3B0aW9uYWwpIE9wdGlvbnMgb2JqZWN0IHRvIG92ZXJyaWRlIGdsb2JhbCBvcHRpb25zLlxuICAgICAgICAqL1xuICAgICAgICBhZGRVc2VyczogZnVuY3Rpb24gKHVzZXJzLCB3b3JsZElkLCBvcHRpb25zKSB7XG5cbiAgICAgICAgICAgIGlmICghdXNlcnMpIHtcbiAgICAgICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ1BsZWFzZSBwcm92aWRlIGEgbGlzdCBvZiB1c2VycyB0byBhZGQgdG8gdGhlIHdvcmxkJyk7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIC8vIG5vcm1hbGl6ZSB0aGUgbGlzdCBvZiB1c2VycyB0byBhbiBhcnJheSBvZiB1c2VyIG9iamVjdHNcbiAgICAgICAgICAgIHVzZXJzID0gJC5tYXAoW10uY29uY2F0KHVzZXJzKSwgZnVuY3Rpb24gKHUpIHtcbiAgICAgICAgICAgICAgICB2YXIgaXNPYmplY3QgPSAkLmlzUGxhaW5PYmplY3QodSk7XG5cbiAgICAgICAgICAgICAgICBpZiAodHlwZW9mIHUgIT09ICdzdHJpbmcnICYmICFpc09iamVjdCkge1xuICAgICAgICAgICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ1NvbWUgb2YgdGhlIHVzZXJzIGluIHRoZSBsaXN0IGFyZSBub3QgaW4gdGhlIHZhbGlkIGZvcm1hdDogJyArIHUpO1xuICAgICAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgICAgIHJldHVybiBpc09iamVjdCA/IHUgOiB7IHVzZXJJZDogdSB9O1xuICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgIC8vIGNoZWNrIGlmIG9wdGlvbnMgd2VyZSBwYXNzZWQgYXMgdGhlIHNlY29uZCBwYXJhbWV0ZXJcbiAgICAgICAgICAgIGlmICgkLmlzUGxhaW5PYmplY3Qod29ybGRJZCkgJiYgIW9wdGlvbnMpIHtcbiAgICAgICAgICAgICAgICBvcHRpb25zID0gd29ybGRJZDtcbiAgICAgICAgICAgICAgICB3b3JsZElkID0gbnVsbDtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgb3B0aW9ucyA9IG9wdGlvbnMgfHwge307XG5cbiAgICAgICAgICAgIC8vIHdlIG11c3QgaGF2ZSBvcHRpb25zIGJ5IG5vd1xuICAgICAgICAgICAgaWYgKHR5cGVvZiB3b3JsZElkID09PSAnc3RyaW5nJykge1xuICAgICAgICAgICAgICAgIG9wdGlvbnMuZmlsdGVyID0gd29ybGRJZDtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgc2V0SWRGaWx0ZXJPclRocm93RXJyb3Iob3B0aW9ucyk7XG5cbiAgICAgICAgICAgIHZhciB1cGRhdGVPcHRpb25zID0gJC5leHRlbmQodHJ1ZSwge30sXG4gICAgICAgICAgICAgICAgc2VydmljZU9wdGlvbnMsXG4gICAgICAgICAgICAgICAgb3B0aW9ucyxcbiAgICAgICAgICAgICAgICB7IHVybDogdXJsQ29uZmlnLmdldEFQSVBhdGgoYXBpRW5kcG9pbnQpICsgc2VydmljZU9wdGlvbnMuZmlsdGVyICsgJy91c2VycycgfVxuICAgICAgICAgICAgKTtcblxuICAgICAgICAgICAgcmV0dXJuIGh0dHAucG9zdCh1c2VycywgdXBkYXRlT3B0aW9ucyk7XG4gICAgICAgIH0sXG5cbiAgICAgICAgLyoqXG4gICAgICAgICogVXBkYXRlcyBhIHVzZXIgZnJvbSBhIGdpdmVuIHdvcmxkIChvbmx5IG9uZSB1c2VyIGF0IGEgdGltZSlcbiAgICAgICAgKlxuICAgICAgICAqIFN1cHBvcnRlZCBmb3JtYXRzOlxuICAgICAgICAqIHdzLnVwZGF0ZVVzZXIoeyB1c2VySWQ6ICdiMWMxOWRkYS0yZDJlLTQ3NzctYWQ1ZC0zOTI5ZjE3ZTg2ZDMnLCByb2xlOiAnbGVhZGVyJyB9KTtcbiAgICAgICAgKlxuICAgICAgICAqIEBwYXJhbSB1c2VyIHtvYmplY3R9IHVzZXIgb2JqZWN0IHdpdGggdXNlcklkIGFuZCB0aGUgbmV3IHJvbGVcbiAgICAgICAgKiBAcGFyYW0gb3B0aW9ucyB7b2JqZWN0fSAoT3B0aW9uYWwpIE9wdGlvbnMgb2JqZWN0IHRvIG92ZXJyaWRlIGdsb2JhbCBvcHRpb25zXG4gICAgICAgICpcbiAgICAgICAgKi9cbiAgICAgICAgdXBkYXRlVXNlcjogZnVuY3Rpb24gKHVzZXIsIG9wdGlvbnMpIHtcbiAgICAgICAgICAgIG9wdGlvbnMgPSBvcHRpb25zIHx8IHt9O1xuXG4gICAgICAgICAgICBpZiAoIXVzZXIgfHwgIXVzZXIudXNlcklkKSB7XG4gICAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdZb3UgbmVlZCB0byBwYXNzIGEgdXNlcklkIHRvIHVwZGF0ZSBmcm9tIHRoZSB3b3JsZCcpO1xuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBzZXRJZEZpbHRlck9yVGhyb3dFcnJvcihvcHRpb25zKTtcblxuICAgICAgICAgICAgdmFyIHBhdGNoT3B0aW9ucyA9ICQuZXh0ZW5kKHRydWUsIHt9LFxuICAgICAgICAgICAgICAgIHNlcnZpY2VPcHRpb25zLFxuICAgICAgICAgICAgICAgIG9wdGlvbnMsXG4gICAgICAgICAgICAgICAgeyB1cmw6IHVybENvbmZpZy5nZXRBUElQYXRoKGFwaUVuZHBvaW50KSArIHNlcnZpY2VPcHRpb25zLmZpbHRlciArICcvdXNlcnMvJyArIHVzZXIudXNlcklkIH1cbiAgICAgICAgICAgICk7XG5cbiAgICAgICAgICAgIHJldHVybiBodHRwLnBhdGNoKF9waWNrKHVzZXIsICdyb2xlJyksIHBhdGNoT3B0aW9ucyk7XG4gICAgICAgIH0sXG5cbiAgICAgICAgLyoqXG4gICAgICAgICogUmVtb3ZlIGFuIGVuZCB1c2VyIGZyb20gYSBnaXZlbiB3b3JsZC5cbiAgICAgICAgKlxuICAgICAgICAqICAqKkV4YW1wbGUqKlxuICAgICAgICAqXG4gICAgICAgICogICAgICB2YXIgd2EgPSBuZXcgRi5zZXJ2aWNlLldvcmxkKHtcbiAgICAgICAgKiAgICAgICAgICAgYWNjb3VudDogJ2FjbWUtc2ltdWxhdGlvbnMnLFxuICAgICAgICAqICAgICAgICAgICBwcm9qZWN0OiAnc3VwcGx5LWNoYWluLWdhbWUnLFxuICAgICAgICAqICAgICAgICAgICBncm91cDogJ3RlYW0xJyB9KTtcbiAgICAgICAgKiAgICAgIHdhLmNyZWF0ZSgpO1xuICAgICAgICAqICAgICAgICAgICAudGhlbihmdW5jdGlvbih3b3JsZCkge1xuICAgICAgICAqICAgICAgICAgICAgICAgd2EuYWRkVXNlcnMoXG4gICAgICAgICogICAgICAgICAgICAgICAgICAgeyB1c2VySWQ6ICdhNmZlMGMxZS1mNGI4LTRmMDEtOWY1Zi0wMWNjZjRjMmVkNDQnIH0sXG4gICAgICAgICogICAgICAgICAgICAgICAgICAgeyB1c2VySWQ6ICc4ZjI2MDRjZi05NmNkLTQ0OWYtODJmYS1lMzMxNTMwNzM0ZWUnIH1cbiAgICAgICAgKiAgICAgICAgICAgICAgICk7XG4gICAgICAgICogICAgICAgICAgICAgICB3YS5yZW1vdmVVc2VyKCdhNmZlMGMxZS1mNGI4LTRmMDEtOWY1Zi0wMWNjZjRjMmVkNDQnKTtcbiAgICAgICAgKiAgICAgICAgICAgICAgIHdhLnJlbW92ZVVzZXIoeyB1c2VySWQ6ICc4ZjI2MDRjZi05NmNkLTQ0OWYtODJmYS1lMzMxNTMwNzM0ZWUnIH0pO1xuICAgICAgICAqICAgICAgICAgICB9KTtcbiAgICAgICAgKlxuICAgICAgICAqICoqIFBhcmFtZXRlcnMgKipcbiAgICAgICAgKiBAcGFyYW0ge29iamVjdHxzdHJpbmd9IGB1c2VyYCBUaGUgYHVzZXJJZGAgb2YgdGhlIHVzZXIgdG8gcmVtb3ZlIGZyb20gdGhlIHdvcmxkLCBvciBhbiBvYmplY3QgY29udGFpbmluZyB0aGUgYHVzZXJJZGAgZmllbGQuXG4gICAgICAgICogQHBhcmFtIHtvYmplY3R9IGBvcHRpb25zYCAoT3B0aW9uYWwpIE9wdGlvbnMgb2JqZWN0IHRvIG92ZXJyaWRlIGdsb2JhbCBvcHRpb25zLlxuICAgICAgICAqL1xuICAgICAgICByZW1vdmVVc2VyOiBmdW5jdGlvbiAodXNlciwgb3B0aW9ucykge1xuICAgICAgICAgICAgb3B0aW9ucyA9IG9wdGlvbnMgfHwge307XG5cbiAgICAgICAgICAgIGlmICh0eXBlb2YgdXNlciA9PT0gJ3N0cmluZycpIHtcbiAgICAgICAgICAgICAgICB1c2VyID0geyB1c2VySWQ6IHVzZXIgfTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgaWYgKCF1c2VyLnVzZXJJZCkge1xuICAgICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcignWW91IG5lZWQgdG8gcGFzcyBhIHVzZXJJZCB0byByZW1vdmUgZnJvbSB0aGUgd29ybGQnKTtcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgc2V0SWRGaWx0ZXJPclRocm93RXJyb3Iob3B0aW9ucyk7XG5cbiAgICAgICAgICAgIHZhciBnZXRPcHRpb25zID0gJC5leHRlbmQodHJ1ZSwge30sXG4gICAgICAgICAgICAgICAgc2VydmljZU9wdGlvbnMsXG4gICAgICAgICAgICAgICAgb3B0aW9ucyxcbiAgICAgICAgICAgICAgICB7IHVybDogdXJsQ29uZmlnLmdldEFQSVBhdGgoYXBpRW5kcG9pbnQpICsgc2VydmljZU9wdGlvbnMuZmlsdGVyICsgJy91c2Vycy8nICsgdXNlci51c2VySWQgfVxuICAgICAgICAgICAgKTtcblxuICAgICAgICAgICAgcmV0dXJuIGh0dHAuZGVsZXRlKG51bGwsIGdldE9wdGlvbnMpO1xuICAgICAgICB9LFxuXG4gICAgICAgIC8qKlxuICAgICAgICAqIEdldHMgdGhlIHJ1biBpZCBvZiBjdXJyZW50IHJ1biBmb3IgdGhlIGdpdmVuIHdvcmxkLiBJZiB0aGUgd29ybGQgZG9lcyBub3QgaGF2ZSBhIHJ1biwgY3JlYXRlcyBhIG5ldyBvbmUgYW5kIHJldHVybnMgdGhlIHJ1biBpZC5cbiAgICAgICAgKlxuICAgICAgICAqIFJlbWVtYmVyIHRoYXQgYSBbcnVuXSguLi8uLi9nbG9zc2FyeS8jcnVuKSBpcyBhIGNvbGxlY3Rpb24gb2YgaW50ZXJhY3Rpb25zIHdpdGggYSBwcm9qZWN0IGFuZCBpdHMgbW9kZWwuIEluIHRoZSBjYXNlIG9mIG11bHRpcGxheWVyIHByb2plY3RzLCB0aGUgcnVuIGlzIHNoYXJlZCBieSBhbGwgZW5kIHVzZXJzIGluIHRoZSB3b3JsZC5cbiAgICAgICAgKlxuICAgICAgICAqICAqKkV4YW1wbGUqKlxuICAgICAgICAqXG4gICAgICAgICogICAgICB2YXIgd2EgPSBuZXcgRi5zZXJ2aWNlLldvcmxkKHtcbiAgICAgICAgKiAgICAgICAgICAgYWNjb3VudDogJ2FjbWUtc2ltdWxhdGlvbnMnLFxuICAgICAgICAqICAgICAgICAgICBwcm9qZWN0OiAnc3VwcGx5LWNoYWluLWdhbWUnLFxuICAgICAgICAqICAgICAgICAgICBncm91cDogJ3RlYW0xJyB9KTtcbiAgICAgICAgKiAgICAgIHdhLmNyZWF0ZSgpO1xuICAgICAgICAqICAgICAgICAgICAudGhlbihmdW5jdGlvbih3b3JsZCkge1xuICAgICAgICAqICAgICAgICAgICAgICAgd2EuZ2V0Q3VycmVudFJ1bklkKHsgbW9kZWw6ICdtb2RlbC5weScgfSk7XG4gICAgICAgICogICAgICAgICAgIH0pO1xuICAgICAgICAqXG4gICAgICAgICogKiogUGFyYW1ldGVycyAqKlxuICAgICAgICAqIEBwYXJhbSB7b2JqZWN0fSBgb3B0aW9uc2AgKE9wdGlvbmFsKSBPcHRpb25zIG9iamVjdCB0byBvdmVycmlkZSBnbG9iYWwgb3B0aW9ucy5cbiAgICAgICAgKiBAcGFyYW0ge29iamVjdH0gYG9wdGlvbnMubW9kZWxgIFRoZSBtb2RlbCBmaWxlIHRvIHVzZSB0byBjcmVhdGUgYSBydW4gaWYgbmVlZGVkLlxuICAgICAgICAqL1xuICAgICAgICBnZXRDdXJyZW50UnVuSWQ6IGZ1bmN0aW9uIChvcHRpb25zKSB7XG4gICAgICAgICAgICBvcHRpb25zID0gb3B0aW9ucyB8fCB7fTtcblxuICAgICAgICAgICAgc2V0SWRGaWx0ZXJPclRocm93RXJyb3Iob3B0aW9ucyk7XG5cbiAgICAgICAgICAgIHZhciBnZXRPcHRpb25zID0gJC5leHRlbmQodHJ1ZSwge30sXG4gICAgICAgICAgICAgICAgc2VydmljZU9wdGlvbnMsXG4gICAgICAgICAgICAgICAgb3B0aW9ucyxcbiAgICAgICAgICAgICAgICB7IHVybDogdXJsQ29uZmlnLmdldEFQSVBhdGgoYXBpRW5kcG9pbnQpICsgc2VydmljZU9wdGlvbnMuZmlsdGVyICsgJy9ydW4nIH1cbiAgICAgICAgICAgICk7XG5cbiAgICAgICAgICAgIHZhbGlkYXRlTW9kZWxPclRocm93RXJyb3IoZ2V0T3B0aW9ucyk7XG4gICAgICAgICAgICByZXR1cm4gaHR0cC5wb3N0KF9waWNrKGdldE9wdGlvbnMsICdtb2RlbCcpLCBnZXRPcHRpb25zKTtcbiAgICAgICAgfSxcblxuICAgICAgICAvKipcbiAgICAgICAgKiBHZXRzIHRoZSBjdXJyZW50IChtb3N0IHJlY2VudCkgd29ybGQgZm9yIHRoZSBnaXZlbiBlbmQgdXNlciBpbiB0aGUgZ2l2ZW4gZ3JvdXAuIEJyaW5ncyB0aGlzIG1vc3QgcmVjZW50IHdvcmxkIGludG8gbWVtb3J5IGlmIG5lZWRlZC5cbiAgICAgICAgKlxuICAgICAgICAqICAqKkV4YW1wbGUqKlxuICAgICAgICAqXG4gICAgICAgICogICAgICB2YXIgd2EgPSBuZXcgRi5zZXJ2aWNlLldvcmxkKHtcbiAgICAgICAgKiAgICAgICAgICAgYWNjb3VudDogJ2FjbWUtc2ltdWxhdGlvbnMnLFxuICAgICAgICAqICAgICAgICAgICBwcm9qZWN0OiAnc3VwcGx5LWNoYWluLWdhbWUnLFxuICAgICAgICAqICAgICAgICAgICBncm91cDogJ3RlYW0xJyB9KTtcbiAgICAgICAgKiAgICAgIHdhLmNyZWF0ZSgpO1xuICAgICAgICAqICAgICAgICAgICAudGhlbihmdW5jdGlvbih3b3JsZCkge1xuICAgICAgICAqICAgICAgICAgICAgICAgd2EuZ2V0Q3VycmVudFdvcmxkRm9yVXNlcignOGYyNjA0Y2YtOTZjZC00NDlmLTgyZmEtZTMzMTUzMDczNGVlJyk7XG4gICAgICAgICogICAgICAgICAgIH0pO1xuICAgICAgICAqXG4gICAgICAgICogKiogUGFyYW1ldGVycyAqKlxuICAgICAgICAqIEBwYXJhbSB7c3RyaW5nfSBgdXNlcklkYCBUaGUgYHVzZXJJZGAgb2YgdGhlIHVzZXIgd2hvc2UgY3VycmVudCAobW9zdCByZWNlbnQpIHdvcmxkIGlzIGJlaW5nIHJldHJpZXZlZC5cbiAgICAgICAgKiBAcGFyYW0ge3N0cmluZ30gYGdyb3VwTmFtZWAgKE9wdGlvbmFsKSBUaGUgbmFtZSBvZiB0aGUgZ3JvdXAuIElmIG5vdCBwcm92aWRlZCwgZGVmYXVsdHMgdG8gdGhlIGdyb3VwIHVzZWQgdG8gY3JlYXRlIHRoZSBzZXJ2aWNlLlxuICAgICAgICAqL1xuICAgICAgICBnZXRDdXJyZW50V29ybGRGb3JVc2VyOiBmdW5jdGlvbiAodXNlcklkLCBncm91cE5hbWUpIHtcbiAgICAgICAgICAgIHZhciBkdGQgPSAkLkRlZmVycmVkKCk7XG4gICAgICAgICAgICB2YXIgbWUgPSB0aGlzO1xuICAgICAgICAgICAgdGhpcy5nZXRXb3JsZHNGb3JVc2VyKHVzZXJJZCwgeyBncm91cDogZ3JvdXBOYW1lIH0pXG4gICAgICAgICAgICAgICAgLnRoZW4oZnVuY3Rpb24gKHdvcmxkcykge1xuICAgICAgICAgICAgICAgICAgICAvLyBhc3N1bWUgdGhlIG1vc3QgcmVjZW50IHdvcmxkIGFzIHRoZSAnYWN0aXZlJyB3b3JsZFxuICAgICAgICAgICAgICAgICAgICB3b3JsZHMuc29ydChmdW5jdGlvbiAoYSwgYikgeyByZXR1cm4gbmV3IERhdGUoYi5sYXN0TW9kaWZpZWQpIC0gbmV3IERhdGUoYS5sYXN0TW9kaWZpZWQpOyB9KTtcbiAgICAgICAgICAgICAgICAgICAgdmFyIGN1cnJlbnRXb3JsZCA9IHdvcmxkc1swXTtcblxuICAgICAgICAgICAgICAgICAgICBpZiAoY3VycmVudFdvcmxkKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBzZXJ2aWNlT3B0aW9ucy5maWx0ZXIgPSAgY3VycmVudFdvcmxkLmlkO1xuICAgICAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICAgICAgZHRkLnJlc29sdmUoY3VycmVudFdvcmxkLCBtZSk7XG4gICAgICAgICAgICAgICAgfSlcbiAgICAgICAgICAgICAgICAuZmFpbChkdGQucmVqZWN0KTtcblxuICAgICAgICAgICAgcmV0dXJuIGR0ZC5wcm9taXNlKCk7XG4gICAgICAgIH0sXG5cbiAgICAgICAgLyoqXG4gICAgICAgICogRGVsZXRlcyB0aGUgY3VycmVudCBydW4gZnJvbSB0aGUgd29ybGQuXG4gICAgICAgICpcbiAgICAgICAgKiAgKipFeGFtcGxlKio6IFRoaXMgbWV0aG9kIGlzIG5vdCB5ZXQgaW1wbGVtZW50ZWQuXG4gICAgICAgICpcbiAgICAgICAgKiAgKipQYXJhbWV0ZXJzKipcbiAgICAgICAgKiBAcGFyYW0ge3N0cmluZ30gYHdvcmxkSWRgXG4gICAgICAgICogQHBhcmFtIHtvYmplY3R9IGBvcHRpb25zYCAoT3B0aW9uYWwpIE9wdGlvbnMgb2JqZWN0IHRvIG92ZXJyaWRlIGdsb2JhbCBvcHRpb25zLlxuICAgICAgICAqL1xuICAgICAgICBkZWxldGVSdW46IGZ1bmN0aW9uICh3b3JsZElkLCBvcHRpb25zKSB7XG4gICAgICAgICAgICBvcHRpb25zID0gb3B0aW9ucyB8fCB7fTtcblxuICAgICAgICAgICAgaWYgKHdvcmxkSWQpIHtcbiAgICAgICAgICAgICAgICBvcHRpb25zLmZpbHRlciA9IHdvcmxkSWQ7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIHNldElkRmlsdGVyT3JUaHJvd0Vycm9yKG9wdGlvbnMpO1xuXG4gICAgICAgICAgICB2YXIgZGVsZXRlT3B0aW9ucyA9ICQuZXh0ZW5kKHRydWUsIHt9LFxuICAgICAgICAgICAgICAgIHNlcnZpY2VPcHRpb25zLFxuICAgICAgICAgICAgICAgIG9wdGlvbnMsXG4gICAgICAgICAgICAgICAgeyB1cmw6IHVybENvbmZpZy5nZXRBUElQYXRoKGFwaUVuZHBvaW50KSArIHNlcnZpY2VPcHRpb25zLmZpbHRlciArICcvcnVuJyB9XG4gICAgICAgICAgICApO1xuXG4gICAgICAgICAgICByZXR1cm4gaHR0cC5kZWxldGUobnVsbCwgZGVsZXRlT3B0aW9ucyk7XG4gICAgICAgIH0sXG5cbiAgICAgICAgLyoqXG4gICAgICAgICogQ3JlYXRlcyBhIG5ldyBydW4gZm9yIHRoZSB3b3JsZC5cbiAgICAgICAgKlxuICAgICAgICAqICAqKkV4YW1wbGUqKjogVGhpcyBtZXRob2QgaXMgbm90IHlldCBpbXBsZW1lbnRlZC5cbiAgICAgICAgKlxuICAgICAgICAqICAqKlBhcmFtZXRlcnMqKlxuICAgICAgICAqIEBwYXJhbSB7c3RyaW5nfSBgd29ybGRJZGAgd29ybGRJZCBpbiB3aGljaCB3ZSBjcmVhdGUgdGhlIG5ldyBSdW4uXG4gICAgICAgICogQHBhcmFtIHtvYmplY3R9IGBvcHRpb25zYCAoT3B0aW9uYWwpIE9wdGlvbnMgb2JqZWN0IHRvIG92ZXJyaWRlIGdsb2JhbCBvcHRpb25zLlxuICAgICAgICAqL1xuICAgICAgICBuZXdSdW5Gb3JXb3JsZDogZnVuY3Rpb24gKHdvcmxkSWQsIG9wdGlvbnMpIHtcbiAgICAgICAgICAgIHZhciBjdXJyZW50UnVuT3B0aW9ucyA9ICQuZXh0ZW5kKHRydWUsIHt9LFxuICAgICAgICAgICAgICAgIG9wdGlvbnMsXG4gICAgICAgICAgICAgICAgeyBmaWx0ZXI6IHdvcmxkSWQgfVxuICAgICAgICAgICAgKTtcbiAgICAgICAgICAgIHZhbGlkYXRlTW9kZWxPclRocm93RXJyb3IoY3VycmVudFJ1bk9wdGlvbnMpO1xuICAgICAgICAgICAgcmV0dXJuIHRoaXMuZGVsZXRlUnVuKHdvcmxkSWQsIG9wdGlvbnMpXG4gICAgICAgICAgICAgICAgLnRoZW4oZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgICAgICAgICByZXR1cm4gdGhpcy5nZXRDdXJyZW50UnVuSWQoY3VycmVudFJ1bk9wdGlvbnMpO1xuICAgICAgICAgICAgICAgIH0pO1xuICAgICAgICB9LFxuXG4gICAgICAgIC8qKlxuICAgICAgICAqIGF1dG9Bc3NpZ24gdXNlcnMgdG8gd29ybGRzXG4gICAgICAgICpcbiAgICAgICAgKlxuICAgICAgICAqL1xuICAgICAgICBhdXRvQXNzaWduOiBmdW5jdGlvbiAob3B0aW9ucykge1xuICAgICAgICAgICAgb3B0aW9ucyA9IG9wdGlvbnMgfHwge307XG5cbiAgICAgICAgICAgIHZhciBvcHQgPSAkLmV4dGVuZCh0cnVlLCB7fSxcbiAgICAgICAgICAgICAgICBzZXJ2aWNlT3B0aW9ucyxcbiAgICAgICAgICAgICAgICBvcHRpb25zLFxuICAgICAgICAgICAgICAgIHsgdXJsOiB1cmxDb25maWcuZ2V0QVBJUGF0aChhc3NpZ25tZW50RW5kcG9pbnQpIH1cbiAgICAgICAgICAgICk7XG5cbiAgICAgICAgICAgIHZhciBwYXJhbXMgPSB7XG4gICAgICAgICAgICAgICAgYWNjb3VudDogb3B0LmFjY291bnQsXG4gICAgICAgICAgICAgICAgcHJvamVjdDogb3B0LnByb2plY3QsXG4gICAgICAgICAgICAgICAgZ3JvdXA6IG9wdC5ncm91cFxuICAgICAgICAgICAgfTtcblxuICAgICAgICAgICAgaWYgKG9wdC5tYXhVc2Vycykge1xuICAgICAgICAgICAgICAgIHBhcmFtcy5tYXhVc2VycyA9IG9wdC5tYXhVc2VycztcbiAgICAgICAgfVxuXG4gICAgICAgICAgICByZXR1cm4gaHR0cC5wb3N0KHBhcmFtcywgb3B0KTtcbiAgICAgICAgfSxcblxuICAgICAgICAvKipcbiAgICAgICAgKiBHZXQgdGhlIHByb2plY3QncyBtdWx0aXVzZXIgY29uZmlndXJhdGlvblxuICAgICAgICAqXG4gICAgICAgICpcbiAgICAgICAgKi9cbiAgICAgICAgZ2V0UHJvamVjdFNldHRpbmdzOiBmdW5jdGlvbiAob3B0aW9ucykge1xuICAgICAgICAgICAgb3B0aW9ucyA9IG9wdGlvbnMgfHwge307XG5cbiAgICAgICAgICAgIHZhciBvcHQgPSAkLmV4dGVuZCh0cnVlLCB7fSxcbiAgICAgICAgICAgICAgICBzZXJ2aWNlT3B0aW9ucyxcbiAgICAgICAgICAgICAgICBvcHRpb25zLFxuICAgICAgICAgICAgICAgIHsgdXJsOiB1cmxDb25maWcuZ2V0QVBJUGF0aChwcm9qZWN0RW5kcG9pbnQpIH1cbiAgICAgICAgICAgICk7XG5cbiAgICAgICAgICAgIG9wdC51cmwgKz0gW29wdC5hY2NvdW50LCBvcHQucHJvamVjdF0uam9pbignLycpO1xuXG4gICAgICAgICAgICByZXR1cm4gaHR0cC5nZXQobnVsbCwgb3B0KTtcbiAgICAgICAgfVxuXG4gICAgfTtcblxuICAgICQuZXh0ZW5kKHRoaXMsIHB1YmxpY0FQSSk7XG59O1xuIiwiLyoqXG4gKiBAY2xhc3MgQ29va2llIFN0b3JhZ2UgU2VydmljZVxuICpcbiAqIEBleGFtcGxlXG4gKiAgICAgIHZhciBwZW9wbGUgPSByZXF1aXJlKCdjb29raWUtc3RvcmUnKSh7IHJvb3Q6ICdwZW9wbGUnIH0pO1xuICAgICAgICBwZW9wbGVcbiAgICAgICAgICAgIC5zYXZlKHtsYXN0TmFtZTogJ3NtaXRoJyB9KVxuXG4gKi9cblxuXG4ndXNlIHN0cmljdCc7XG5cbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24gKGNvbmZpZykge1xuICAgIHZhciBkZWZhdWx0cyA9IHtcbiAgICAgICAgLyoqXG4gICAgICAgICAqIE5hbWUgb2YgY29sbGVjdGlvblxuICAgICAgICAgKiBAdHlwZSB7IHN0cmluZ31cbiAgICAgICAgICovXG4gICAgICAgIHJvb3Q6ICcvJyxcblxuICAgICAgICBkb21haW46ICcuZm9yaW8uY29tJ1xuICAgIH07XG4gICAgdmFyIHNlcnZpY2VPcHRpb25zID0gJC5leHRlbmQoe30sIGRlZmF1bHRzLCBjb25maWcpO1xuXG4gICAgdmFyIHB1YmxpY0FQSSA9IHtcbiAgICAgICAgLy8gKiBUQkRcbiAgICAgICAgLy8gICogUXVlcnkgY29sbGVjdGlvbjsgdXNlcyBNb25nb0RCIHN5bnRheFxuICAgICAgICAvLyAgKiBAc2VlICA8VEJEOiBEYXRhIEFQSSBVUkw+XG4gICAgICAgIC8vICAqXG4gICAgICAgIC8vICAqIEBwYXJhbSB7IHN0cmluZ30gcXMgUXVlcnkgRmlsdGVyXG4gICAgICAgIC8vICAqIEBwYXJhbSB7IHN0cmluZ30gbGltaXRlcnMgQHNlZSA8VEJEOiB1cmwgZm9yIGxpbWl0cywgcGFnaW5nIGV0Yz5cbiAgICAgICAgLy8gICpcbiAgICAgICAgLy8gICogQGV4YW1wbGVcbiAgICAgICAgLy8gICogICAgIGNzLnF1ZXJ5KFxuICAgICAgICAvLyAgKiAgICAgIHsgbmFtZTogJ0pvaG4nLCBjbGFzc05hbWU6ICdDU0MxMDEnIH0sXG4gICAgICAgIC8vICAqICAgICAge2xpbWl0OiAxMH1cbiAgICAgICAgLy8gICogICAgIClcblxuICAgICAgICAvLyBxdWVyeTogZnVuY3Rpb24gKHFzLCBsaW1pdGVycykge1xuXG4gICAgICAgIC8vIH0sXG5cbiAgICAgICAgLyoqXG4gICAgICAgICAqIFNhdmUgY29va2llIHZhbHVlXG4gICAgICAgICAqIEBwYXJhbSAgeyBzdHJpbmd8T2JqZWN0fSBrZXkgICBJZiBnaXZlbiBhIGtleSBzYXZlIHZhbHVlcyB1bmRlciBpdCwgaWYgZ2l2ZW4gYW4gb2JqZWN0IGRpcmVjdGx5LCBzYXZlIHRvIHRvcC1sZXZlbCBhcGlcbiAgICAgICAgICogQHBhcmFtICB7T2JqZWN0fSB2YWx1ZSAoT3B0aW9uYWwpXG4gICAgICAgICAqIEBwYXJhbSB7T2JqZWN0fSBvcHRpb25zIE92ZXJyaWRlcyBmb3Igc2VydmljZSBvcHRpb25zXG4gICAgICAgICAqXG4gICAgICAgICAqIEByZXR1cm4geyp9IFRoZSBzYXZlZCB2YWx1ZVxuICAgICAgICAgKlxuICAgICAgICAgKiBAZXhhbXBsZVxuICAgICAgICAgKiAgICAgY3Muc2V0KCdwZXJzb24nLCB7IGZpcnN0TmFtZTogJ2pvaG4nLCBsYXN0TmFtZTogJ3NtaXRoJyB9KTtcbiAgICAgICAgICogICAgIGNzLnNldCh7IG5hbWU6J3NtaXRoJywgYWdlOiczMicgfSk7XG4gICAgICAgICAqL1xuICAgICAgICBzZXQ6IGZ1bmN0aW9uIChrZXksIHZhbHVlLCBvcHRpb25zKSB7XG4gICAgICAgICAgICB2YXIgc2V0T3B0aW9ucyA9ICQuZXh0ZW5kKHRydWUsIHt9LCBzZXJ2aWNlT3B0aW9ucywgb3B0aW9ucyk7XG5cbiAgICAgICAgICAgIHZhciBkb21haW4gPSBzZXRPcHRpb25zLmRvbWFpbjtcbiAgICAgICAgICAgIHZhciBwYXRoID0gc2V0T3B0aW9ucy5yb290O1xuXG4gICAgICAgICAgICBkb2N1bWVudC5jb29raWUgPSBlbmNvZGVVUklDb21wb25lbnQoa2V5KSArICc9JyArXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGVuY29kZVVSSUNvbXBvbmVudCh2YWx1ZSkgK1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAoZG9tYWluID8gJzsgZG9tYWluPScgKyBkb21haW4gOiAnJykgK1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAocGF0aCA/ICc7IHBhdGg9JyArIHBhdGggOiAnJyk7XG5cbiAgICAgICAgICAgIHJldHVybiB2YWx1ZTtcbiAgICAgICAgfSxcblxuICAgICAgICAvKipcbiAgICAgICAgICogTG9hZCBjb29raWUgdmFsdWVcbiAgICAgICAgICogQHBhcmFtICB7IHN0cmluZ3xPYmplY3R9IGtleSAgIElmIGdpdmVuIGEga2V5IHNhdmUgdmFsdWVzIHVuZGVyIGl0LCBpZiBnaXZlbiBhbiBvYmplY3QgZGlyZWN0bHksIHNhdmUgdG8gdG9wLWxldmVsIGFwaVxuICAgICAgICAgKiBAcmV0dXJuIHsqfSBUaGUgdmFsdWUgc3RvcmVkXG4gICAgICAgICAqXG4gICAgICAgICAqIEBleGFtcGxlXG4gICAgICAgICAqICAgICBjcy5nZXQoJ3BlcnNvbicpO1xuICAgICAgICAgKi9cbiAgICAgICAgZ2V0OiBmdW5jdGlvbiAoa2V5KSB7XG4gICAgICAgICAgICB2YXIgY29va2llUmVnID0gbmV3IFJlZ0V4cCgnKD86KD86XnwuKjspXFxcXHMqJyArIGVuY29kZVVSSUNvbXBvbmVudChrZXkpLnJlcGxhY2UoL1tcXC1cXC5cXCtcXCpdL2csICdcXFxcJCYnKSArICdcXFxccypcXFxcPVxcXFxzKihbXjtdKikuKiQpfF4uKiQnKTtcbiAgICAgICAgICAgIHZhciB2YWwgPSBkb2N1bWVudC5jb29raWUucmVwbGFjZShjb29raWVSZWcsICckMScpO1xuICAgICAgICAgICAgdmFsID0gZGVjb2RlVVJJQ29tcG9uZW50KHZhbCkgfHwgbnVsbDtcbiAgICAgICAgICAgIHJldHVybiB2YWw7XG4gICAgICAgIH0sXG5cbiAgICAgICAgLyoqXG4gICAgICAgICAqIFJlbW92ZXMga2V5IGZyb20gY29sbGVjdGlvblxuICAgICAgICAgKiBAcGFyYW0geyBzdHJpbmd9IGtleSBrZXkgdG8gcmVtb3ZlXG4gICAgICAgICAqIEByZXR1cm4geyBzdHJpbmd9IGtleSBUaGUga2V5IHJlbW92ZWRcbiAgICAgICAgICpcbiAgICAgICAgICogQGV4YW1wbGVcbiAgICAgICAgICogICAgIGNzLnJlbW92ZSgncGVyc29uJyk7XG4gICAgICAgICAqL1xuICAgICAgICByZW1vdmU6IGZ1bmN0aW9uIChrZXksIG9wdGlvbnMpIHtcbiAgICAgICAgICAgIHZhciByZW1PcHRpb25zID0gJC5leHRlbmQodHJ1ZSwge30sIHNlcnZpY2VPcHRpb25zLCBvcHRpb25zKTtcblxuICAgICAgICAgICAgdmFyIGRvbWFpbiA9IHJlbU9wdGlvbnMuZG9tYWluO1xuICAgICAgICAgICAgdmFyIHBhdGggPSByZW1PcHRpb25zLnJvb3Q7XG5cbiAgICAgICAgICAgIGRvY3VtZW50LmNvb2tpZSA9IGVuY29kZVVSSUNvbXBvbmVudChrZXkpICtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAnPTsgZXhwaXJlcz1UaHUsIDAxIEphbiAxOTcwIDAwOjAwOjAwIEdNVCcgK1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIChkb21haW4gPyAnOyBkb21haW49JyArIGRvbWFpbiA6ICcnKSArXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgKHBhdGggPyAnOyBwYXRoPScgKyBwYXRoIDogJycpO1xuICAgICAgICAgICAgcmV0dXJuIGtleTtcbiAgICAgICAgfSxcblxuICAgICAgICAvKipcbiAgICAgICAgICogUmVtb3ZlcyBjb2xsZWN0aW9uIGJlaW5nIHJlZmVyZW5jZWRcbiAgICAgICAgICogQHJldHVybiB7IGFycmF5fSBrZXlzIEFsbCB0aGUga2V5cyByZW1vdmVkXG4gICAgICAgICAqL1xuICAgICAgICBkZXN0cm95OiBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICB2YXIgYUtleXMgPSBkb2N1bWVudC5jb29raWUucmVwbGFjZSgvKCg/Ol58XFxzKjspW15cXD1dKykoPz07fCQpfF5cXHMqfFxccyooPzpcXD1bXjtdKik/KD86XFwxfCQpL2csICcnKS5zcGxpdCgvXFxzKig/OlxcPVteO10qKT87XFxzKi8pO1xuICAgICAgICAgICAgZm9yICh2YXIgbklkeCA9IDA7IG5JZHggPCBhS2V5cy5sZW5ndGg7IG5JZHgrKykge1xuICAgICAgICAgICAgICAgIHZhciBjb29raWVLZXkgPSBkZWNvZGVVUklDb21wb25lbnQoYUtleXNbbklkeF0pO1xuICAgICAgICAgICAgICAgIHRoaXMucmVtb3ZlKGNvb2tpZUtleSk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICByZXR1cm4gYUtleXM7XG4gICAgICAgIH1cbiAgICB9O1xuXG4gICAgJC5leHRlbmQodGhpcywgcHVibGljQVBJKTtcbn07XG4iLCIvKipcbiAgICBEZWNpZGVzIHR5cGUgb2Ygc3RvcmUgdG8gcHJvdmlkZVxuKi9cblxuJ3VzZSBzdHJpY3QnO1xuLy8gdmFyIGlzTm9kZSA9IGZhbHNlOyBGSVhNRTogQnJvd3NlcmlmeS9taW5pZnlpZnkgaGFzIGlzc3VlcyB3aXRoIHRoZSBuZXh0IGxpbmtcbi8vIHZhciBzdG9yZSA9IChpc05vZGUpID8gcmVxdWlyZSgnLi9zZXNzaW9uLXN0b3JlJykgOiByZXF1aXJlKCcuL2Nvb2tpZS1zdG9yZScpO1xudmFyIHN0b3JlID0gcmVxdWlyZSgnLi9jb29raWUtc3RvcmUnKTtcblxubW9kdWxlLmV4cG9ydHMgPSBzdG9yZTtcbiIsIid1c2Ugc3RyaWN0JztcblxudmFyIHF1dGlscyA9IHJlcXVpcmUoJy4uL3V0aWwvcXVlcnktdXRpbCcpO1xuXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uIChjb25maWcpIHtcblxuICAgIHZhciBkZWZhdWx0cyA9IHtcbiAgICAgICAgdXJsOiAnJyxcblxuICAgICAgICBjb250ZW50VHlwZTogJ2FwcGxpY2F0aW9uL2pzb24nLFxuICAgICAgICBoZWFkZXJzOiB7fSxcbiAgICAgICAgc3RhdHVzQ29kZToge1xuICAgICAgICAgICAgNDA0OiAkLm5vb3BcbiAgICAgICAgfSxcblxuICAgICAgICAvKipcbiAgICAgICAgICogT05MWSBmb3Igc3RyaW5ncyBpbiB0aGUgdXJsLiBBbGwgR0VUICYgREVMRVRFIHBhcmFtcyBhcmUgcnVuIHRocm91Z2ggdGhpc1xuICAgICAgICAgKiBAdHlwZSB7W3R5cGVdIH1cbiAgICAgICAgICovXG4gICAgICAgIHBhcmFtZXRlclBhcnNlcjogcXV0aWxzLnRvUXVlcnlGb3JtYXQsXG5cbiAgICAgICAgLy8gVG8gYWxsb3cgZXBpY2VudGVyLnRva2VuIGFuZCBvdGhlciBzZXNzaW9uIGNvb2tpZXMgdG8gYmUgcGFzc2VkXG4gICAgICAgIC8vIHdpdGggdGhlIHJlcXVlc3RzXG4gICAgICAgIHhockZpZWxkczoge1xuICAgICAgICAgICAgd2l0aENyZWRlbnRpYWxzOiB0cnVlXG4gICAgICAgIH1cbiAgICB9O1xuXG4gICAgdmFyIHRyYW5zcG9ydE9wdGlvbnMgPSAkLmV4dGVuZCh7fSwgZGVmYXVsdHMsIGNvbmZpZyk7XG5cbiAgICB2YXIgcmVzdWx0ID0gZnVuY3Rpb24gKGQpIHtcbiAgICAgICAgcmV0dXJuICgkLmlzRnVuY3Rpb24oZCkpID8gZCgpIDogZDtcbiAgICB9O1xuXG4gICAgdmFyIGNvbm5lY3QgPSBmdW5jdGlvbiAobWV0aG9kLCBwYXJhbXMsIGNvbm5lY3RPcHRpb25zKSB7XG4gICAgICAgIHBhcmFtcyA9IHJlc3VsdChwYXJhbXMpO1xuICAgICAgICBwYXJhbXMgPSAoJC5pc1BsYWluT2JqZWN0KHBhcmFtcykgfHwgJC5pc0FycmF5KHBhcmFtcykpID8gSlNPTi5zdHJpbmdpZnkocGFyYW1zKSA6IHBhcmFtcztcblxuICAgICAgICB2YXIgb3B0aW9ucyA9ICQuZXh0ZW5kKHRydWUsIHt9LCB0cmFuc3BvcnRPcHRpb25zLCBjb25uZWN0T3B0aW9ucywge1xuICAgICAgICAgICAgdHlwZTogbWV0aG9kLFxuICAgICAgICAgICAgZGF0YTogcGFyYW1zXG4gICAgICAgIH0pO1xuICAgICAgICB2YXIgQUxMT1dFRF9UT19CRV9GVU5DVElPTlMgPSBbJ2RhdGEnLCAndXJsJ107XG4gICAgICAgICQuZWFjaChvcHRpb25zLCBmdW5jdGlvbiAoa2V5LCB2YWx1ZSkge1xuICAgICAgICAgICAgaWYgKCQuaXNGdW5jdGlvbih2YWx1ZSkgJiYgJC5pbkFycmF5KGtleSwgQUxMT1dFRF9UT19CRV9GVU5DVElPTlMpICE9PSAtMSkge1xuICAgICAgICAgICAgICAgIG9wdGlvbnNba2V5XSA9IHZhbHVlKCk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0pO1xuXG4gICAgICAgIGlmIChvcHRpb25zLmxvZ0xldmVsICYmIG9wdGlvbnMubG9nTGV2ZWwgPT09ICdERUJVRycpIHtcbiAgICAgICAgICAgIGNvbnNvbGUubG9nKG9wdGlvbnMudXJsKTtcbiAgICAgICAgICAgIHZhciBvbGRTdWNjZXNzRm4gPSBvcHRpb25zLnN1Y2Nlc3MgfHwgJC5ub29wO1xuICAgICAgICAgICAgb3B0aW9ucy5zdWNjZXNzID0gZnVuY3Rpb24gKHJlc3BvbnNlLCBhamF4U3RhdHVzLCBhamF4UmVxKSB7XG4gICAgICAgICAgICAgICAgY29uc29sZS5sb2cocmVzcG9uc2UpO1xuICAgICAgICAgICAgICAgIG9sZFN1Y2Nlc3NGbi5hcHBseSh0aGlzLCBhcmd1bWVudHMpO1xuICAgICAgICAgICAgfTtcbiAgICAgICAgfVxuXG4gICAgICAgIHZhciBiZWZvcmVTZW5kID0gb3B0aW9ucy5iZWZvcmVTZW5kO1xuICAgICAgICBvcHRpb25zLmJlZm9yZVNlbmQgPSBmdW5jdGlvbiAoeGhyLCBzZXR0aW5ncykge1xuICAgICAgICAgICAgeGhyLnJlcXVlc3RVcmwgPSAoY29ubmVjdE9wdGlvbnMgfHwge30pLnVybDtcbiAgICAgICAgICAgIGlmIChiZWZvcmVTZW5kKSB7XG4gICAgICAgICAgICAgICAgYmVmb3JlU2VuZC5hcHBseSh0aGlzLCBhcmd1bWVudHMpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9O1xuXG4gICAgICAgIHJldHVybiAkLmFqYXgob3B0aW9ucyk7XG4gICAgfTtcblxuICAgIHZhciBwdWJsaWNBUEkgPSB7XG4gICAgICAgIGdldDpmdW5jdGlvbiAocGFyYW1zLCBhamF4T3B0aW9ucykge1xuICAgICAgICAgICAgdmFyIG9wdGlvbnMgPSAkLmV4dGVuZCh7fSwgdHJhbnNwb3J0T3B0aW9ucywgYWpheE9wdGlvbnMpO1xuICAgICAgICAgICAgcGFyYW1zID0gb3B0aW9ucy5wYXJhbWV0ZXJQYXJzZXIocmVzdWx0KHBhcmFtcykpO1xuICAgICAgICAgICAgcmV0dXJuIGNvbm5lY3QuY2FsbCh0aGlzLCAnR0VUJywgcGFyYW1zLCBvcHRpb25zKTtcbiAgICAgICAgfSxcbiAgICAgICAgcG9zdDogZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgcmV0dXJuIGNvbm5lY3QuYXBwbHkodGhpcywgWydwb3N0J10uY29uY2F0KFtdLnNsaWNlLmNhbGwoYXJndW1lbnRzKSkpO1xuICAgICAgICB9LFxuICAgICAgICBwYXRjaDogZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgcmV0dXJuIGNvbm5lY3QuYXBwbHkodGhpcywgWydwYXRjaCddLmNvbmNhdChbXS5zbGljZS5jYWxsKGFyZ3VtZW50cykpKTtcbiAgICAgICAgfSxcbiAgICAgICAgcHV0OiBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICByZXR1cm4gY29ubmVjdC5hcHBseSh0aGlzLCBbJ3B1dCddLmNvbmNhdChbXS5zbGljZS5jYWxsKGFyZ3VtZW50cykpKTtcbiAgICAgICAgfSxcbiAgICAgICAgZGVsZXRlOiBmdW5jdGlvbiAocGFyYW1zLCBhamF4T3B0aW9ucykge1xuICAgICAgICAgICAgLy9ERUxFVEUgZG9lc24ndCBzdXBwb3J0IGJvZHkgcGFyYW1zLCBidXQgalF1ZXJ5IHRoaW5rcyBpdCBkb2VzLlxuICAgICAgICAgICAgdmFyIG9wdGlvbnMgPSAkLmV4dGVuZCh7fSwgdHJhbnNwb3J0T3B0aW9ucywgYWpheE9wdGlvbnMpO1xuICAgICAgICAgICAgcGFyYW1zID0gb3B0aW9ucy5wYXJhbWV0ZXJQYXJzZXIocmVzdWx0KHBhcmFtcykpO1xuICAgICAgICAgICAgaWYgKCQudHJpbShwYXJhbXMpKSB7XG4gICAgICAgICAgICAgICAgdmFyIGRlbGltaXRlciA9IChyZXN1bHQob3B0aW9ucy51cmwpLmluZGV4T2YoJz8nKSA9PT0gLTEpID8gJz8nIDogJyYnO1xuICAgICAgICAgICAgICAgIG9wdGlvbnMudXJsID0gcmVzdWx0KG9wdGlvbnMudXJsKSArIGRlbGltaXRlciArIHBhcmFtcztcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJldHVybiBjb25uZWN0LmNhbGwodGhpcywgJ0RFTEVURScsIG51bGwsIG9wdGlvbnMpO1xuICAgICAgICB9LFxuICAgICAgICBoZWFkOiBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICByZXR1cm4gY29ubmVjdC5hcHBseSh0aGlzLCBbJ2hlYWQnXS5jb25jYXQoW10uc2xpY2UuY2FsbChhcmd1bWVudHMpKSk7XG4gICAgICAgIH0sXG4gICAgICAgIG9wdGlvbnM6IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIHJldHVybiBjb25uZWN0LmFwcGx5KHRoaXMsIFsnb3B0aW9ucyddLmNvbmNhdChbXS5zbGljZS5jYWxsKGFyZ3VtZW50cykpKTtcbiAgICAgICAgfVxuICAgIH07XG5cbiAgICByZXR1cm4gJC5leHRlbmQodGhpcywgcHVibGljQVBJKTtcbn07XG4iLCIndXNlIHN0cmljdCc7XG5cbi8vIHZhciBpc05vZGUgPSBmYWxzZTsgRklYTUU6IEJyb3dzZXJpZnkvbWluaWZ5aWZ5IGhhcyBpc3N1ZXMgd2l0aCB0aGUgbmV4dCBsaW5rXG4vLyB2YXIgdHJhbnNwb3J0ID0gKGlzTm9kZSkgPyByZXF1aXJlKCcuL25vZGUtaHR0cC10cmFuc3BvcnQnKSA6IHJlcXVpcmUoJy4vYWpheC1odHRwLXRyYW5zcG9ydCcpO1xudmFyIHRyYW5zcG9ydCA9IHJlcXVpcmUoJy4vYWpheC1odHRwLXRyYW5zcG9ydCcpO1xubW9kdWxlLmV4cG9ydHMgPSB0cmFuc3BvcnQ7XG4iLCIvKipcbi8qIEluaGVyaXQgZnJvbSBhIGNsYXNzICh1c2luZyBwcm90b3R5cGUgYm9ycm93aW5nKVxuKi9cbid1c2Ugc3RyaWN0JztcblxuZnVuY3Rpb24gaW5oZXJpdChDLCBQKSB7XG4gICAgdmFyIEYgPSBmdW5jdGlvbiAoKSB7fTtcbiAgICBGLnByb3RvdHlwZSA9IFAucHJvdG90eXBlO1xuICAgIEMucHJvdG90eXBlID0gbmV3IEYoKTtcbiAgICBDLl9fc3VwZXIgPSBQLnByb3RvdHlwZTtcbiAgICBDLnByb3RvdHlwZS5jb25zdHJ1Y3RvciA9IEM7XG59XG5cbi8qKlxuKiBTaGFsbG93IGNvcHkgb2YgYW4gb2JqZWN0XG4qL1xudmFyIGV4dGVuZCA9IGZ1bmN0aW9uIChkZXN0IC8qLCB2YXJfYXJncyovKSB7XG4gICAgdmFyIG9iaiA9IEFycmF5LnByb3RvdHlwZS5zbGljZS5jYWxsKGFyZ3VtZW50cywgMSk7XG4gICAgdmFyIGN1cnJlbnQ7XG4gICAgZm9yICh2YXIgaiA9IDA7IGo8b2JqLmxlbmd0aDsgaisrKSB7XG4gICAgICAgIGlmICghKGN1cnJlbnQgPSBvYmpbal0pKSB7XG4gICAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIGRvIG5vdCB3cmFwIGlubmVyIGluIGRlc3QuaGFzT3duUHJvcGVydHkgb3IgYmFkIHRoaW5ncyB3aWxsIGhhcHBlblxuICAgICAgICAvKmpzaGludCAtVzA4OSAqL1xuICAgICAgICBmb3IgKHZhciBrZXkgaW4gY3VycmVudCkge1xuICAgICAgICAgICAgZGVzdFtrZXldID0gY3VycmVudFtrZXldO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIGRlc3Q7XG59O1xuXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uIChiYXNlLCBwcm9wcywgc3RhdGljUHJvcHMpIHtcbiAgICB2YXIgcGFyZW50ID0gYmFzZTtcbiAgICB2YXIgY2hpbGQ7XG5cbiAgICBjaGlsZCA9IHByb3BzICYmIHByb3BzLmhhc093blByb3BlcnR5KCdjb25zdHJ1Y3RvcicpID8gcHJvcHMuY29uc3RydWN0b3IgOiBmdW5jdGlvbiAoKSB7IHJldHVybiBwYXJlbnQuYXBwbHkodGhpcywgYXJndW1lbnRzKTsgfTtcblxuICAgIC8vIGFkZCBzdGF0aWMgcHJvcGVydGllcyB0byB0aGUgY2hpbGQgY29uc3RydWN0b3IgZnVuY3Rpb25cbiAgICBleHRlbmQoY2hpbGQsIHBhcmVudCwgc3RhdGljUHJvcHMpO1xuXG4gICAgLy8gYXNzb2NpYXRlIHByb3RvdHlwZSBjaGFpblxuICAgIGluaGVyaXQoY2hpbGQsIHBhcmVudCk7XG5cbiAgICAvLyBhZGQgaW5zdGFuY2UgcHJvcGVydGllc1xuICAgIGlmIChwcm9wcykge1xuICAgICAgICBleHRlbmQoY2hpbGQucHJvdG90eXBlLCBwcm9wcyk7XG4gICAgfVxuXG4gICAgLy8gZG9uZVxuICAgIHJldHVybiBjaGlsZDtcbn07XG4iLCIndXNlIHN0cmljdCc7XG4vKmpzaGludCBsb29wZnVuYzpmYWxzZSAqL1xuXG5mdW5jdGlvbiBfdyh2YWwpIHtcbiAgICBpZiAodmFsICYmIHZhbC50aGVuKSB7XG4gICAgICAgIHJldHVybiB2YWw7XG4gICAgfVxuICAgIHZhciBwID0gJC5EZWZlcnJlZCgpO1xuICAgIHAucmVzb2x2ZSh2YWwpO1xuXG4gICAgcmV0dXJuIHAucHJvbWlzZSgpO1xufVxuXG5mdW5jdGlvbiBzZXEoKSB7XG4gICAgdmFyIGxpc3QgPSBBcnJheS5wcm90b3R5cGUuc2xpY2UuYXBwbHkoYXJndW1lbnRzKTtcblxuICAgIGZ1bmN0aW9uIG5leHQocCkge1xuICAgICAgICB2YXIgY3VyID0gbGlzdC5zcGxpY2UoMCwxKVswXTtcblxuICAgICAgICBpZiAoIWN1cikge1xuICAgICAgICAgICAgcmV0dXJuIHA7XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gX3coY3VyKHApKS50aGVuKG5leHQpO1xuICAgIH1cblxuICAgIHJldHVybiBmdW5jdGlvbiAoc2VlZCkge1xuICAgICAgICByZXR1cm4gbmV4dChzZWVkKS5mYWlsKHNlcS5mYWlsKTtcbiAgICB9O1xufVxuXG5mdW5jdGlvbiBNYWtlU2VxKG9iaikge1xuICAgIHZhciByZXMgPSB7XG4gICAgICAgIF9fY2FsbHM6IFtdLFxuXG4gICAgICAgIG9yaWdpbmFsOiBvYmosXG5cbiAgICAgICAgdGhlbjogZnVuY3Rpb24gKGZuKSB7XG4gICAgICAgICAgICB0aGlzLl9fY2FsbHMucHVzaChmbik7XG4gICAgICAgICAgICByZXR1cm4gdGhpcztcbiAgICAgICAgfSxcblxuICAgICAgICBzdGFydDogZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgdmFyIF90aGlzID0gdGhpcztcblxuICAgICAgICAgICAgLy8gY2xlYW4gdXBcbiAgICAgICAgICAgIHRoaXMudGhlbihmdW5jdGlvbiAocnVuKSB7XG4gICAgICAgICAgICAgICAgX3RoaXMuX19jYWxscy5sZW5ndGggPSAwO1xuICAgICAgICAgICAgICAgIHJldHVybiBydW47XG4gICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgcmV0dXJuIHNlcS5hcHBseShudWxsLCB0aGlzLl9fY2FsbHMpKCk7XG4gICAgICAgIH0sXG5cbiAgICAgICAgZmFpbDogZnVuY3Rpb24gKGZuKSB7XG4gICAgICAgICAgICBzZXEuZmFpbCA9IGZuO1xuICAgICAgICAgICAgcmV0dXJuIHRoaXM7XG4gICAgICAgIH1cbiAgICB9O1xuXG4gICAgdmFyIGZ1bmNNYWtlciA9IGZ1bmN0aW9uIChwLCBvYmopIHtcbiAgICAgICAgdmFyIGZuID0gb2JqW3BdLmJpbmQob2JqKTtcbiAgICAgICAgcmV0dXJuIGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIHZhciBhcmdzID0gQXJyYXkucHJvdG90eXBlLnNsaWNlLmFwcGx5KGFyZ3VtZW50cyk7XG4gICAgICAgICAgICB0aGlzLl9fY2FsbHMucHVzaChGdW5jdGlvbi5iaW5kLmFwcGx5KGZuLCBbbnVsbF0uY29uY2F0KGFyZ3MpKSk7XG4gICAgICAgICAgICByZXR1cm4gdGhpcztcbiAgICAgICAgfTtcbiAgICB9O1xuXG4gICAgZm9yICh2YXIgcHJvcCBpbiBvYmopIHtcbiAgICAgICAgaWYgKHR5cGVvZiBvYmpbcHJvcF0gPT09ICdmdW5jdGlvbicpIHtcbiAgICAgICAgICAgIHJlc1twcm9wXSA9IGZ1bmNNYWtlcihwcm9wLCBvYmopO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgcmVzW3Byb3BdID0gb2JqW3Byb3BdO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIHJlcztcbn1cblxubW9kdWxlLmV4cG9ydHMgPSBNYWtlU2VxO1xuIiwiJ3VzZSBzdHJpY3QnO1xuXG5tb2R1bGUuZXhwb3J0cyA9IHtcbiAgICBfcGljazogZnVuY3Rpb24gKG9iaiwgcHJvcHMpIHtcbiAgICAgICAgdmFyIHJlcyA9IHt9O1xuICAgICAgICBmb3IgKHZhciBwIGluIG9iaikge1xuICAgICAgICAgICAgaWYgKHByb3BzLmluZGV4T2YocCkgIT09IC0xKSB7XG4gICAgICAgICAgICAgICAgcmVzW3BdID0gb2JqW3BdO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgcmV0dXJuIHJlcztcbiAgICB9XG59O1xuIiwiLyoqXG4gKiBVdGlsaXRpZXMgZm9yIHdvcmtpbmcgd2l0aCBxdWVyeSBzdHJpbmdzXG4qL1xuJ3VzZSBzdHJpY3QnO1xuXG5tb2R1bGUuZXhwb3J0cyA9IChmdW5jdGlvbiAoKSB7XG5cbiAgICByZXR1cm4ge1xuICAgICAgICAvKipcbiAgICAgICAgICogQ29udmVydHMgdG8gbWF0cml4IGZvcm1hdFxuICAgICAgICAgKiBAcGFyYW0gIHtPYmplY3R9IHFzIE9iamVjdCB0byBjb252ZXJ0IHRvIHF1ZXJ5IHN0cmluZ1xuICAgICAgICAgKiBAcmV0dXJuIHsgc3RyaW5nfSAgICBNYXRyaXgtZm9ybWF0IHF1ZXJ5IHBhcmFtZXRlcnNcbiAgICAgICAgICovXG4gICAgICAgIHRvTWF0cml4Rm9ybWF0OiBmdW5jdGlvbiAocXMpIHtcbiAgICAgICAgICAgIGlmIChxcyA9PT0gbnVsbCB8fCBxcyA9PT0gdW5kZWZpbmVkIHx8IHFzID09PSAnJykge1xuICAgICAgICAgICAgICAgIHJldHVybiAnOyc7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBpZiAodHlwZW9mIHFzID09PSAnc3RyaW5nJyB8fCBxcyBpbnN0YW5jZW9mIFN0cmluZykge1xuICAgICAgICAgICAgICAgIHJldHVybiBxcztcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgdmFyIHJldHVybkFycmF5ID0gW107XG4gICAgICAgICAgICB2YXIgT1BFUkFUT1JTID0gWyc8JywgJz4nLCAnISddO1xuICAgICAgICAgICAgJC5lYWNoKHFzLCBmdW5jdGlvbiAoa2V5LCB2YWx1ZSkge1xuICAgICAgICAgICAgICAgIGlmICh0eXBlb2YgdmFsdWUgIT09ICdzdHJpbmcnIHx8ICQuaW5BcnJheSgkLnRyaW0odmFsdWUpLmNoYXJBdCgwKSwgT1BFUkFUT1JTKSA9PT0gLTEpIHtcbiAgICAgICAgICAgICAgICAgICAgdmFsdWUgPSAnPScgKyB2YWx1ZTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgcmV0dXJuQXJyYXkucHVzaChrZXkgKyB2YWx1ZSk7XG4gICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgdmFyIG10cnggPSAnOycgKyByZXR1cm5BcnJheS5qb2luKCc7Jyk7XG4gICAgICAgICAgICByZXR1cm4gbXRyeDtcbiAgICAgICAgfSxcblxuICAgICAgICAvKipcbiAgICAgICAgICogQ29udmVydHMgc3RyaW5ncy9hcnJheXMvb2JqZWN0cyB0byB0eXBlICdhPWImYj1jJ1xuICAgICAgICAgKiBAcGFyYW0gIHsgc3RyaW5nfEFycmF5fE9iamVjdH0gcXNcbiAgICAgICAgICogQHJldHVybiB7IHN0cmluZ31cbiAgICAgICAgICovXG4gICAgICAgIHRvUXVlcnlGb3JtYXQ6IGZ1bmN0aW9uIChxcykge1xuICAgICAgICAgICAgaWYgKHFzID09PSBudWxsIHx8IHFzID09PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gJyc7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBpZiAodHlwZW9mIHFzID09PSAnc3RyaW5nJyB8fCBxcyBpbnN0YW5jZW9mIFN0cmluZykge1xuICAgICAgICAgICAgICAgIHJldHVybiBxcztcbiAgICAgICAgICAgIH1cblxuICAgICAgICAgICAgdmFyIHJldHVybkFycmF5ID0gW107XG4gICAgICAgICAgICAkLmVhY2gocXMsIGZ1bmN0aW9uIChrZXksIHZhbHVlKSB7XG4gICAgICAgICAgICAgICAgaWYgKCQuaXNBcnJheSh2YWx1ZSkpIHtcbiAgICAgICAgICAgICAgICAgICAgdmFsdWUgPSB2YWx1ZS5qb2luKCcsJyk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIGlmICgkLmlzUGxhaW5PYmplY3QodmFsdWUpKSB7XG4gICAgICAgICAgICAgICAgICAgIC8vTW9zdGx5IGZvciBkYXRhIGFwaVxuICAgICAgICAgICAgICAgICAgICB2YWx1ZSA9IEpTT04uc3RyaW5naWZ5KHZhbHVlKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgcmV0dXJuQXJyYXkucHVzaChrZXkgKyAnPScgKyB2YWx1ZSk7XG4gICAgICAgICAgICB9KTtcblxuICAgICAgICAgICAgdmFyIHJlc3VsdCA9IHJldHVybkFycmF5LmpvaW4oJyYnKTtcbiAgICAgICAgICAgIHJldHVybiByZXN1bHQ7XG4gICAgICAgIH0sXG5cbiAgICAgICAgLyoqXG4gICAgICAgICAqIENvbnZlcnRzIHN0cmluZ3Mgb2YgdHlwZSAnYT1iJmI9YycgdG8geyBhOmIsIGI6Y31cbiAgICAgICAgICogQHBhcmFtICB7IHN0cmluZ30gcXNcbiAgICAgICAgICogQHJldHVybiB7b2JqZWN0fVxuICAgICAgICAgKi9cbiAgICAgICAgcXNUb09iamVjdDogZnVuY3Rpb24gKHFzKSB7XG4gICAgICAgICAgICBpZiAocXMgPT09IG51bGwgfHwgcXMgPT09IHVuZGVmaW5lZCB8fCBxcyA9PT0gJycpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4ge307XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIHZhciBxc0FycmF5ID0gcXMuc3BsaXQoJyYnKTtcbiAgICAgICAgICAgIHZhciByZXR1cm5PYmogPSB7fTtcbiAgICAgICAgICAgICQuZWFjaChxc0FycmF5LCBmdW5jdGlvbiAoaW5kZXgsIHZhbHVlKSB7XG4gICAgICAgICAgICAgICAgdmFyIHFLZXkgPSB2YWx1ZS5zcGxpdCgnPScpWzBdO1xuICAgICAgICAgICAgICAgIHZhciBxVmFsID0gdmFsdWUuc3BsaXQoJz0nKVsxXTtcblxuICAgICAgICAgICAgICAgIGlmIChxVmFsLmluZGV4T2YoJywnKSAhPT0gLTEpIHtcbiAgICAgICAgICAgICAgICAgICAgcVZhbCA9IHFWYWwuc3BsaXQoJywnKTtcbiAgICAgICAgICAgICAgICB9XG5cbiAgICAgICAgICAgICAgICByZXR1cm5PYmpbcUtleV0gPSBxVmFsO1xuICAgICAgICAgICAgfSk7XG5cbiAgICAgICAgICAgIHJldHVybiByZXR1cm5PYmo7XG4gICAgICAgIH0sXG5cbiAgICAgICAgLyoqXG4gICAgICAgICAqIE5vcm1hbGl6ZXMgYW5kIG1lcmdlcyBzdHJpbmdzIG9mIHR5cGUgJ2E9YicsIHsgYjpjfSB0byB7IGE6YiwgYjpjfVxuICAgICAgICAgKiBAcGFyYW0gIHsgc3RyaW5nfEFycmF5fE9iamVjdH0gcXMxXG4gICAgICAgICAqIEBwYXJhbSAgeyBzdHJpbmd8QXJyYXl8T2JqZWN0fSBxczJcbiAgICAgICAgICogQHJldHVybiB7T2JqZWN0fVxuICAgICAgICAgKi9cbiAgICAgICAgbWVyZ2VRUzogZnVuY3Rpb24gKHFzMSwgcXMyKSB7XG4gICAgICAgICAgICB2YXIgb2JqMSA9IHRoaXMucXNUb09iamVjdCh0aGlzLnRvUXVlcnlGb3JtYXQocXMxKSk7XG4gICAgICAgICAgICB2YXIgb2JqMiA9IHRoaXMucXNUb09iamVjdCh0aGlzLnRvUXVlcnlGb3JtYXQocXMyKSk7XG4gICAgICAgICAgICByZXR1cm4gJC5leHRlbmQodHJ1ZSwge30sIG9iajEsIG9iajIpO1xuICAgICAgICB9LFxuXG4gICAgICAgIGFkZFRyYWlsaW5nU2xhc2g6IGZ1bmN0aW9uICh1cmwpIHtcbiAgICAgICAgICAgIGlmICghdXJsKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuICcnO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgcmV0dXJuICh1cmwuY2hhckF0KHVybC5sZW5ndGggLSAxKSA9PT0gJy8nKSA/IHVybCA6ICh1cmwgKyAnLycpO1xuICAgICAgICB9XG4gICAgfTtcbn0oKSk7XG5cblxuXG4iLCIvKipcbiAqIFV0aWxpdGllcyBmb3Igd29ya2luZyB3aXRoIHRoZSBydW4gc2VydmljZVxuKi9cbid1c2Ugc3RyaWN0JztcblxubW9kdWxlLmV4cG9ydHMgPSAoZnVuY3Rpb24gKCkge1xuICAgIHJldHVybiB7XG4gICAgICAgIC8qKlxuICAgICAgICAgKiByZXR1cm5zIG9wZXJhdGlvbnMgb2YgdGhlIGZvcm0gW1tvcDEsb3AyXSwgW2FyZzEsIGFyZzJdXVxuICAgICAgICAgKiBAcGFyYW0gIHtPYmplY3R8QXJyYXl8U3RyaW5nfSBvcGVyYXRpb25zIG9wZXJhdGlvbnMgdG8gcGVyZm9ybVxuICAgICAgICAgKiBAcGFyYW0gIHsgYXJyYXl9IGFydWdtZW50cyBmb3Igb3BlcmF0aW9uXG4gICAgICAgICAqIEByZXR1cm4geyBzdHJpbmd9ICAgIE1hdHJpeC1mb3JtYXQgcXVlcnkgcGFyYW1ldGVyc1xuICAgICAgICAgKi9cbiAgICAgICAgbm9ybWFsaXplT3BlcmF0aW9uczogZnVuY3Rpb24gKG9wZXJhdGlvbnMsIGFyZ3MpIHtcbiAgICAgICAgICAgIGlmICghYXJncykge1xuICAgICAgICAgICAgICAgIGFyZ3MgPSBbXTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHZhciByZXR1cm5MaXN0ID0ge1xuICAgICAgICAgICAgICAgIG9wczogW10sXG4gICAgICAgICAgICAgICAgYXJnczogW11cbiAgICAgICAgICAgIH07XG5cbiAgICAgICAgICAgIHZhciBfY29uY2F0ID0gZnVuY3Rpb24gKGFycikge1xuICAgICAgICAgICAgICAgIHJldHVybiAoYXJyICE9PSBudWxsICYmIGFyciAhPT0gdW5kZWZpbmVkKSA/IFtdLmNvbmNhdChhcnIpIDogW107XG4gICAgICAgICAgICB9O1xuXG4gICAgICAgICAgICAvL3sgYWRkOiBbMSwyXSwgc3VidHJhY3Q6IFsyLDRdIH1cbiAgICAgICAgICAgIHZhciBfbm9ybWFsaXplUGxhaW5PYmplY3RzID0gZnVuY3Rpb24gKG9wZXJhdGlvbnMsIHJldHVybkxpc3QpIHtcbiAgICAgICAgICAgICAgICBpZiAoIXJldHVybkxpc3QpIHtcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuTGlzdCA9IHsgb3BzOiBbXSwgYXJnczogW10gfTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgJC5lYWNoKG9wZXJhdGlvbnMsIGZ1bmN0aW9uIChvcG4sIGFyZykge1xuICAgICAgICAgICAgICAgICAgICByZXR1cm5MaXN0Lm9wcy5wdXNoKG9wbik7XG4gICAgICAgICAgICAgICAgICAgIHJldHVybkxpc3QuYXJncy5wdXNoKF9jb25jYXQoYXJnKSk7XG4gICAgICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICAgICAgcmV0dXJuIHJldHVybkxpc3Q7XG4gICAgICAgICAgICB9O1xuICAgICAgICAgICAgLy97IG5hbWU6ICdhZGQnLCBwYXJhbXM6IFsxXSB9XG4gICAgICAgICAgICB2YXIgX25vcm1hbGl6ZVN0cnVjdHVyZWRPYmplY3RzID0gZnVuY3Rpb24gKG9wZXJhdGlvbiwgcmV0dXJuTGlzdCkge1xuICAgICAgICAgICAgICAgIGlmICghcmV0dXJuTGlzdCkge1xuICAgICAgICAgICAgICAgICAgICByZXR1cm5MaXN0ID0geyBvcHM6IFtdLCBhcmdzOiBbXSB9O1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICByZXR1cm5MaXN0Lm9wcy5wdXNoKG9wZXJhdGlvbi5uYW1lKTtcbiAgICAgICAgICAgICAgICByZXR1cm5MaXN0LmFyZ3MucHVzaChfY29uY2F0KG9wZXJhdGlvbi5wYXJhbXMpKTtcbiAgICAgICAgICAgICAgICByZXR1cm4gcmV0dXJuTGlzdDtcbiAgICAgICAgICAgIH07XG5cbiAgICAgICAgICAgIHZhciBfbm9ybWFsaXplT2JqZWN0ID0gZnVuY3Rpb24gKG9wZXJhdGlvbiwgcmV0dXJuTGlzdCkge1xuICAgICAgICAgICAgICAgIHJldHVybiAoKG9wZXJhdGlvbi5uYW1lKSA/IF9ub3JtYWxpemVTdHJ1Y3R1cmVkT2JqZWN0cyA6IF9ub3JtYWxpemVQbGFpbk9iamVjdHMpKG9wZXJhdGlvbiwgcmV0dXJuTGlzdCk7XG4gICAgICAgICAgICB9O1xuXG4gICAgICAgICAgICB2YXIgX25vcm1hbGl6ZUxpdGVyYWxzID0gZnVuY3Rpb24gKG9wZXJhdGlvbiwgYXJncywgcmV0dXJuTGlzdCkge1xuICAgICAgICAgICAgICAgIGlmICghcmV0dXJuTGlzdCkge1xuICAgICAgICAgICAgICAgICAgICByZXR1cm5MaXN0ID0geyBvcHM6IFtdLCBhcmdzOiBbXSB9O1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICByZXR1cm5MaXN0Lm9wcy5wdXNoKG9wZXJhdGlvbik7XG4gICAgICAgICAgICAgICAgcmV0dXJuTGlzdC5hcmdzLnB1c2goX2NvbmNhdChhcmdzKSk7XG4gICAgICAgICAgICAgICAgcmV0dXJuIHJldHVybkxpc3Q7XG4gICAgICAgICAgICB9O1xuXG5cbiAgICAgICAgICAgIHZhciBfbm9ybWFsaXplQXJyYXlzID0gZnVuY3Rpb24gKG9wZXJhdGlvbnMsIGFyZywgcmV0dXJuTGlzdCkge1xuICAgICAgICAgICAgICAgIGlmICghcmV0dXJuTGlzdCkge1xuICAgICAgICAgICAgICAgICAgICByZXR1cm5MaXN0ID0geyBvcHM6IFtdLCBhcmdzOiBbXSB9O1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAkLmVhY2gob3BlcmF0aW9ucywgZnVuY3Rpb24gKGluZGV4LCBvcG4pIHtcbiAgICAgICAgICAgICAgICAgICAgaWYgKCQuaXNQbGFpbk9iamVjdChvcG4pKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBfbm9ybWFsaXplT2JqZWN0KG9wbiwgcmV0dXJuTGlzdCk7XG4gICAgICAgICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgICAgICAgICBfbm9ybWFsaXplTGl0ZXJhbHMob3BuLCBhcmdzW2luZGV4XSwgcmV0dXJuTGlzdCk7XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9KTtcbiAgICAgICAgICAgICAgICByZXR1cm4gcmV0dXJuTGlzdDtcbiAgICAgICAgICAgIH07XG5cbiAgICAgICAgICAgIGlmICgkLmlzUGxhaW5PYmplY3Qob3BlcmF0aW9ucykpIHtcbiAgICAgICAgICAgICAgICBfbm9ybWFsaXplT2JqZWN0KG9wZXJhdGlvbnMsIHJldHVybkxpc3QpO1xuICAgICAgICAgICAgfSBlbHNlIGlmICgkLmlzQXJyYXkob3BlcmF0aW9ucykpIHtcbiAgICAgICAgICAgICAgICBfbm9ybWFsaXplQXJyYXlzKG9wZXJhdGlvbnMsIGFyZ3MsIHJldHVybkxpc3QpO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICBfbm9ybWFsaXplTGl0ZXJhbHMob3BlcmF0aW9ucywgYXJncywgcmV0dXJuTGlzdCk7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIHJldHVybiByZXR1cm5MaXN0O1xuICAgICAgICB9XG4gICAgfTtcbn0oKSk7XG4iXX0=
