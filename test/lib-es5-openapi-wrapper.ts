/// <reference no-default-lib="true" />
/// <reference path="../node_modules/typescript/lib/lib.es5.d.ts" />

interface ObjectStaticsSurface extends Pick<ObjectConstructor,
  | 'getPrototypeOf'
  | 'getOwnPropertyDescriptor'
  | 'getOwnPropertyNames'
  | 'create'
  | 'defineProperty'
  | 'defineProperties'
  | 'seal'
  | 'freeze'
  | 'preventExtensions'
  | 'isSealed'
  | 'isFrozen'
  | 'isExtensible'
  | 'keys'
> {}

interface StringStaticsSurface extends Pick<StringConstructor, 'fromCharCode'> {}
interface ArrayStaticsSurface extends Pick<ArrayConstructor, 'isArray'> {}
interface DateStaticsSurface extends Pick<DateConstructor, 'parse' | 'UTC' | 'now'> {}
interface Int8ArrayStaticsSurface extends Pick<Int8ArrayConstructor, 'of' | 'from'> {}
interface Uint8ArrayStaticsSurface extends Pick<Uint8ArrayConstructor, 'of' | 'from'> {}
interface Uint8ClampedArrayStaticsSurface extends Pick<Uint8ClampedArrayConstructor, 'of' | 'from'> {}
interface Int16ArrayStaticsSurface extends Pick<Int16ArrayConstructor, 'of' | 'from'> {}
interface Uint16ArrayStaticsSurface extends Pick<Uint16ArrayConstructor, 'of' | 'from'> {}
interface Int32ArrayStaticsSurface extends Pick<Int32ArrayConstructor, 'of' | 'from'> {}
interface Uint32ArrayStaticsSurface extends Pick<Uint32ArrayConstructor, 'of' | 'from'> {}
interface Float32ArrayStaticsSurface extends Pick<Float32ArrayConstructor, 'of' | 'from'> {}
interface Float64ArrayStaticsSurface extends Pick<Float64ArrayConstructor, 'of' | 'from'> {}

export interface LibEs5SurfaceSource {
  eval: typeof eval;
  parseInt: typeof parseInt;
  parseFloat: typeof parseFloat;
  isNaN: typeof isNaN;
  isFinite: typeof isFinite;
  decodeURI: typeof decodeURI;
  decodeURIComponent: typeof decodeURIComponent;
  encodeURI: typeof encodeURI;
  encodeURIComponent: typeof encodeURIComponent;
  escape: typeof escape;
  unescape: typeof unescape;
  Math: Math;
  JSON: JSON;
  ObjectPrototype: Object;
  ObjectStatics: ObjectStaticsSurface;
  FunctionPrototype: Function;
  StringPrototype: String;
  StringStatics: StringStaticsSurface;
  BooleanPrototype: Boolean;
  NumberPrototype: Number;
  DatePrototype: Date;
  DateStatics: DateStaticsSurface;
  RegExpPrototype: RegExp;
  ArrayPrototype: Array<unknown>;
  ReadonlyArrayPrototype: ReadonlyArray<unknown>;
  Int8ArrayPrototype: Int8Array;
  Int8ArrayStatics: Int8ArrayStaticsSurface;
  Uint8ArrayPrototype: Uint8Array;
  Uint8ArrayStatics: Uint8ArrayStaticsSurface;
  Uint8ClampedArrayPrototype: Uint8ClampedArray;
  Uint8ClampedArrayStatics: Uint8ClampedArrayStaticsSurface;
  Int16ArrayPrototype: Int16Array;
  Int16ArrayStatics: Int16ArrayStaticsSurface;
  Uint16ArrayPrototype: Uint16Array;
  Uint16ArrayStatics: Uint16ArrayStaticsSurface;
  Int32ArrayPrototype: Int32Array;
  Int32ArrayStatics: Int32ArrayStaticsSurface;
  Uint32ArrayPrototype: Uint32Array;
  Uint32ArrayStatics: Uint32ArrayStaticsSurface;
  Float32ArrayPrototype: Float32Array;
  Float32ArrayStatics: Float32ArrayStaticsSurface;
  Float64ArrayPrototype: Float64Array;
  Float64ArrayStatics: Float64ArrayStaticsSurface;
}
