/*
 * object-initializers.ts
 * Author: derkallevombau
 * Created: Mar 17, 2021
 */

/* eslint-disable tsdoc/syntax */

/// Initialiser types

/**
 * Creates an initialiser for the public properties of type `T`, which can be a literal
 * object type, an interface or a class.\
 * \
 * Example:
 * ```typescript
 * 	class Person
 * 	{
 * 		name: string;
 * 		dayOfBirth: number;
 * 		job: string;
 *
 * 		constructor(config: Initialiser<Person>) { applyConfig(config, this); }
 * 	}
 *
 * 	const cassie = new Person({ name: 'Cassie Quinn', dayOfBirth: Date.parse('1997-5-15'), job: 'Nurse'});
 * ```
 */
// N.B.: We use a "Mapped type" here to construct an object type for the initialiser
// that contains all the properties and their respective types of the class:
// - 'keyof', the "Index type query operator", yields the union of known,
//   public property names of 'T'.
// - '[K in keyof T]' is an "Index signature". 'K in <Union type>' means
//   'K' iterates over the members of the union, i. e. the property names of 'T'.
// - 'T[K]', the "Indexed access operator", yields the type of property K.
//   Note the analogy to the expression syntax: If 'obj' is an object of type 'T',
//   the expression 'obj[K]' has the type 'T[K]' for each 'K' that is equal to
//   the name of a property of 'T'.
// - TypeScript is awesome :)
export type Initialiser<T> = { [K in keyof T]: T[K] }; // = Pick<T, keyof T>

/**
 * Creates an initialiser for the public properties of type `T`,
 * excluding those in union `Keys`.\
 * `T` can be a literal object type, an interface or a class.
 */
// N.B.: - 'extends' in 'Exclude<T, U> = T extends U ? never: T'
//         is distributive since the operands are type parameters!
//         This means that the expression is evaluated for each possible
//         combination of union members of T and U, and the result is a new
//         union consisting of these partial results.
//       - We must use "Type remapping via as" here: '{ [K in Exclude<keyof T, Keys>]: T[K] }'
//         would remove the optional modifier '?' and probably 'readonly' too (not tested).
export type InitialiserExclude<T, Keys extends keyof T> = { [K in keyof T as Exclude<K, Keys>]: T[K] };

/**
 * Creates an initialiser for the public properties of type `T`,
 * making those in union `Keys` optional.\
 * `T` can be a literal object type, an interface or a class.
 */
// N.B.: - Type parameter constraint: As in a conditional type, 'extends' means
//         that the type on the left must be assignable to the type on the right.
//         Think of subclassing: 'class B extends A'. An instance of B (the subclass)
//         is assignable to a variable of base class type, not vice versa.
//         Here, we ensure that union Keys is a (non-strict) subset of the union of
//         all keys of T. This ensures K (in Keys) to be a key of T, so we are allowed
//         to write T[K].
//       - The first type contains all properties of T EXCEPT those in union Keys.
//       - The second type contains ONLY the properties of T in union Keys, made optional.
//       - The & operator creates a type containing all properties of these two type.
//         This is called an "Intersection type", an expression that can easily be misunderstood
//         because in mathematics, the intersection of two sets A and B only contains the elements
//         that are contained in A AND B.
//         Regarding mathematics, this is a union, but a "Union type" in TS is something different :)
export type InitialiserOptional<T, Keys extends keyof T> = InitialiserExclude<T, Keys> & { [K in Keys]?: T[K] };

/**
 * Creates an initialiser for the public properties of type `T`,
 * excluding those in union `KeysEx` and making those in union `KeysOpt` optional.\
 * `T` can be a literal object type, an interface or a class.
 */
// N.B.: Compared with InitialiserOptional, it should be pretty clear how this one works ;)
export type InitialiserExcludeOptional<T, KeysEx extends keyof T, KeysOpt extends keyof T> = InitialiserExclude<T, KeysEx | KeysOpt> & { [K in KeysOpt]?: T[K] };

/**
 * Creates an initialiser for the public properties of type `T`,
 * excluding those with type in union `KeyTypes`.\
 * `T` can be a literal object type, an interface or a class.
 */
export type InitialiserExcludeByType<T, KeyTypes> = { [K in keyof T as ExcludeByType<T, K, KeyTypes>]: T[K] };

/// Utility types

/**
 * For a literal object type, an interface or a class `T` and a property name `K`,\
 * gives `never` if the type of `K` is assignable to any type of union `U`.\
 * \
 * This cannot be used the same way as `Exclude`.\
 * \
 * Even though the Indexed access operator is a homomorphism,
 * i. e. if `K` was a union of property names, `I[K]` would be the union
 * of the respective types, `extends` is only distributive if both operands
 * are type parameters, like in `Exclude`.\
 * \
 * With `I[K]`, distributivity gets lost, so this works only if `K` is a single
 * property name.\
 * \
 * Thus, we cannot write an index signature like\
 * `[K in ExcludeByValueType<I, keyof I, Function>]: I[K]`\
 * to create a mapped type with all methods removed, in analogy to\
 * `[K in Exclude<keyof I, 'foo'>]: I[K]`\
 * to create a mapped type with property 'foo' removed.\
 * \
 * Luckily, the latter can also be written as\
 * `[K in keyof I as Exclude<K, 'foo'>]: I[K]`\
 * using "Key remapping via as" (since TS 4.1), where `K` is always a single property
 * name at a time.\
 * \
 * So in analogy to this construct, we can write\
 * `[K in keyof I as ExcludeByValueType<I, K, Function>]: I[K]`.
 */
type ExcludeByType<T, K extends keyof T, U> = T[K] extends U ? never : K;

/// Functions

/**
 * Call this within a ctor using an initialiser:\
 * `applyConfig(config, this);`
 */
export function applyConfig(config: { [key: string]: unknown; }, object: unknown): void
{
	// Here, we merely need to iterate over the keys of 'initialiser'
	// and assign the respective value to the respective property of our instance.
	for (const k in config) object[k] = config[k];
}
