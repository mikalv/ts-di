import {SuperConstructor as SuperConstructorAnnotation, readAnnotations} from './annotations';
import {isClass, isFunction, isObject, toString} from './util';


// Provider is responsible for creating instances.
//
// responsibilities:
// - create instances
//
// communication:
// - exposes `create()` which creates an instance of something
// - exposes `params` (information about which arguments it requires to be passed into `create()`)
//
// Injector reads `provider.params` first, create these dependencies (however it wants),
// then calls `provider.create(args)`, passing in these arguments.


// TODO(vojta): duplicate from injector.js, remove
function constructResolvingMessage(resolving, token = null) {
  if (token) {
    resolving.push(token);
  }

  if (resolving.length > 1) {
    return ` (${resolving.map(toString).join(' -> ')})`;
  }

  return '';
}


var EmptyFunction = Object.getPrototypeOf(Function);


// ClassProvider knows how to instantiate classes.
//
// If a class inherits (has parent constructors), this provider normalizes all the dependencies
// into a single flat array first, so that the injector does not need to worry about inheritance.
//
// - all the state is immutable (constructed)
//
// TODO(vojta): super constructor - should be only allowed during the constructor call?
class ClassProvider {
  constructor(clazz, params, isPromise) {
    // TODO(vojta): can we hide this.provider? (only used for hasAnnotation(provider.provider))
    this.provider = clazz;
    this.isPromise = isPromise;

    this.params = [];
    this.constructors = [];

    this._flattenParams(clazz, params);
    this.constructors.unshift([clazz, 0, this.params.length - 1]);
  }

  // Normalize params for all the constructors (in the case of inheritance),
  // into a single flat array of DependencyDesriptors.
  // So that the injector does not have to worry about inheritance.
  //
  // This function mutates `this.params` and `this.constructors`,
  // but it is only called during the constructor.
  // TODO(vojta): remove the annotations argument?
  _flattenParams(constructor, params) {
    var token;
    var SuperConstructor;
    var constructorInfo;

    for (var param of params) {
      if (param.token === SuperConstructorAnnotation) {
        SuperConstructor = Object.getPrototypeOf(constructor);

        if (SuperConstructor === EmptyFunction) {
          // TODO(vojta): fix this, we are not resolving yet, when should we throw?
          // Probably as early as possible.
          var resolving = [];
          var resolvingMsg = constructResolvingMessage(resolving);
          throw new Error(`Only classes with a parent can ask for SuperConstructor!${resolvingMsg}`);
        }

        constructorInfo = [SuperConstructor, this.params.length];
        this.constructors.push(constructorInfo);
        this._flattenParams(SuperConstructor, readAnnotations(SuperConstructor).params);
        constructorInfo.push(this.params.length - 1);
      } else {
        this.params.push(param);
      }
    }
  }

  // Basically the reverse process to `this._flattenParams`:
  // We get arguments for all the constructors as a single flat array.
  // This method generates pre-bound "superConstructor" wrapper with correctly passing arguments.
  _createConstructor(currentConstructorIdx, context, allArguments) {
    var constructorInfo = this.constructors[currentConstructorIdx];
    var nextConstructorInfo = this.constructors[currentConstructorIdx + 1];
    var argsForCurrentConstructor;

    if (nextConstructorInfo) {
      argsForCurrentConstructor = allArguments
          .slice(constructorInfo[1], nextConstructorInfo[1])
          .concat([this._createConstructor(currentConstructorIdx + 1, context, allArguments)])
          .concat(allArguments.slice(nextConstructorInfo[2] + 1, constructorInfo[2] + 1));
    } else {
      argsForCurrentConstructor = allArguments.slice(constructorInfo[1], constructorInfo[2] + 1);
    }

    return function InjectedAndBoundSuperConstructor() {
      // TODO(vojta): throw if arguments given
      return constructorInfo[0].apply(context, argsForCurrentConstructor);
    }
  }

  // It is called by injector to create an instance.
  // TODO(vojta): refactor resolving, token (it's just for the error message)
  create(args, resolving, token) {
    var context = Object.create(this.provider.prototype);
    var constructor = this._createConstructor(0, context, args);
    var returnedValue;

    try {
      returnedValue = constructor();
    } catch (e) {
      var resolvingMsg = constructResolvingMessage(resolving);
      var originalMsg = 'ORIGINAL ERROR: ' + e.message;
      e.message = `Error during instantiation of ${toString(token)}!${resolvingMsg}\n${originalMsg}`;
      throw e;
    }

    if (isFunction(returnedValue) || isObject(returnedValue)) {
      return returnedValue;
    }

    return context;
  }
}


// FactoryProvider knows how to create instance from a factory function.
// - all the state is immutable
class FactoryProvider {
  constructor(factoryFunction, params, isPromise) {
    this.provider = factoryFunction;
    this.params = params;
    this.isPromise = isPromise;

    for (var param of params) {
      if (param.token === SuperConstructorAnnotation) {
        throw new Error('Only classes with a parent can ask for SuperConstructor!');
      }
    }
  }

  create(args, resolving, token) {
    // TODO(vojta): should we move the try/catch to injector
    try {
      return this.provider.apply(undefined, args);
    } catch (e) {
      var resolvingMsg = constructResolvingMessage(resolving);
      var originalMsg = 'ORIGINAL ERROR: ' + e.message;
      e.message = `Error during instantiation of ${toString(token)}!${resolvingMsg}\n${originalMsg}`;
      throw e;
    }
  }
}


export function createProviderFromFnOrClass(fnOrClass, annotations) {
  if (isClass(fnOrClass)) {
    return new ClassProvider(fnOrClass, annotations.params, annotations.provide.isPromise);
  }

  return new FactoryProvider(fnOrClass, annotations.params, annotations.provide.isPromise);
}
