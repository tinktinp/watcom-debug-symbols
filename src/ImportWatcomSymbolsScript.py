## ###
#  IP: GHIDRA
# 
#  Licensed under the Apache License, Version 2.0 (the "License");
#  you may not use this file except in compliance with the License.
#  You may obtain a copy of the License at
#  
#       http://www.apache.org/licenses/LICENSE-2.0
#  
#  Unless required by applicable law or agreed to in writing, software
#  distributed under the License is distributed on an "AS IS" BASIS,
#  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
#  See the License for the specific language governing permissions and
#  limitations under the License.
##
# Based in part on "ImportSymbolsScript.py".
#
# Load a JSON file in a particular format that contains Watcom Debug Symbols
# and create the symbols and types contained in that file.
#
# @category Data
# @runtime Jython
#

addressFactory = getAddressFactory()


try:
    from ghidra.ghidra_builtins import *
    from typing import TYPE_CHECKING, cast, assert_type
    if TYPE_CHECKING:
        from ghidra.program.model.address import AddressFactory
        from ghidra.ghidra_builtins import *
        from ghidra.ghidra_builtins import currentProgram, monitor, sourceFile, state, writer, currentAddress, currentLocation
        addressFactory = cast('AddressFactory', None)
        addressFactory = getAddressFactory()
except:
    pass


from ghidra.program.model.symbol.SourceType import *
from ghidra.program.model.data import Undefined, FunctionDefinitionDataType, StructureDataType, CategoryPath, VoidDataType, AbstractIntegerDataType, AbstractFloatDataType, AbstractComplexDataType, TypedefDataType, DataTypeConflictHandler, Pointer32DataType, ArrayDataType
# import string
from ghidra.program.model.util import CodeUnitInsertionException
from ghidra.program.model.address import AddressSet
from ghidra.program.model.listing import ParameterImpl, VariableStorage
from ghidra.program.model.listing import LocalVariableImpl, Function
from ghidra.program.model.symbol import SourceType
from ghidra.program.model.listing import ReturnParameterImpl
from ghidra.util.exception import DuplicateNameException


from generic.json import JSONParser, JSONError
from java.lang import String
from java.util import ArrayList, Map, List
import sys

# currentProgram
# currentSelection
# currentAddress


def java_to_python(obj):
    """Recursively convert Java Maps/Lists/primitives returned by convert() into Python types."""
    if obj is None:
        return None
    # java.util.Map -> dict
    if isinstance(obj, Map):
        py = {}
        for entry in obj.entrySet():
            key = entry.getKey()
            py[str(key)] = java_to_python(entry.getValue())
        return py
    # java.util.List -> list
    if isinstance(obj, List):
        out = []
        for i in range(obj.size()):
            out.append(java_to_python(obj.get(i)))
        return out
    # primitives (String, Number, Boolean) come through fine under Jython
    return obj

def load_json_as_py(f):
    """Return JSON at `path` as native Python dict/list (raises on parse error)."""
    text = file(f.absolutePath, "r").read()
    #print(text)
    chars = String(text).toCharArray()          # parser expects a char[]
    tokens = ArrayList()                        # List<JSONToken>
    parser = JSONParser()
    err = parser.parse(chars, tokens)           # parse(char[], List<JSONToken>)
    if err != JSONError.JSMN_SUCCESS:
        raise ValueError("JSON parse failed: %s" % err)
    parsed = parser.convert(chars, tokens)      # convert(char[], List<JSONToken>) -> Object
    # print(type(parsed)) 
    # return java_to_python(parsed)
    return parsed



f = askFile("Give me a file to open", "Go baby go!")

data = load_json_as_py(f)
# print(type(data))       # <type 'dict'>
# print(data.keys())      # dict keys
debuggingRegion = data["debuggingRegion"]
modules = debuggingRegion["modules"]     
modulesDict = dict()
for module in modules:
    modulesDict[module['moduleIndex']] = module

modulesLocals = debuggingRegion["modulesLocals"]

modulesTypes = debuggingRegion["modulesTypes"]
modulesTypesDict = dict()
for moduleType in modulesTypes:
    moduleIndex = moduleType['meta']['moduleIndex']
    entries = modulesTypesDict.get(moduleIndex, [])
    entries.extend(moduleType['entries'])
    modulesTypesDict[moduleIndex] = entries
    if len(entries) > 0 and entries[0]['selfIndex'] != 0:
        entries.insert(0, {'selfIndex': 0, 'typeName': 'dummy'})
    # print(moduleIndex)
# print(modulesTypesDict)

globalSymbolsTable = debuggingRegion["globalSymbolsTable"]
addressesTable = debuggingRegion["addressesTable"]

listing = currentProgram.getListing()
rootProgramModule = listing.getDefaultRootModule()
dtm = currentProgram.getDataTypeManager()

segmentToName = {1: 'BEGTEXT', 2: 'SCODE', 3: 'DGROUP' }

def getMemoryBlockFromSegment(segment):
    # memoryBlock = getMemoryBlock('.object' + str(segment))
    memoryBlock = getMemoryBlock(segmentToName[segment])
    return memoryBlock

def getAddressFromSegment(segment, address):
    memoryBlock = getMemoryBlockFromSegment(segment)
    return memoryBlock.getStart().add(address)

def groupIntoFragments():
    for addrTable in addressesTable:
        segment = addrTable["segment"]
        memoryBlock = getMemoryBlock(segmentToName[segment])
        # print(memoryBlock)
        # print(memoryBlock.getStart())
        for addrInfo in addrTable["addressInfo"]:
            module = modules[addrInfo["moduleIndex"]]
            fragmentName = module["name"]
            #print(module)
            startAddress = memoryBlock.getStart().add(addrInfo["address"])
            # print(startAddress)
            # startAddress = toAddr(addrInfo["address"])
            fragment = getFragment(rootProgramModule, fragmentName)
            try:
                if fragment is None:
                    # print("fragment was None")
                    fragment = createFragment(module["name"], startAddress, addrInfo["size"])
                else:
                    # print("fragment found")
                    endAddress = startAddress.add(addrInfo["size"])
                    fragment.move(startAddress, endAddress)
            except (Exception, ghidra.util.exception.NotFoundException) as e:
                print("Exception!")
                print(e)

def createTypeCategory(name):
    return CategoryPath(name) 

typeCache = dict()
def createType(moduleIndex, typeIndex, withName = None, withNameIndex = None):
    if moduleIndex not in typeCache:
        typeCache[moduleIndex] = dict()
    if typeIndex in typeCache[moduleIndex]:
        return typeCache[moduleIndex][typeIndex]
    else:
        pass
        # We were setting key to prevent loops, but we need pointers to recurse sometimes.
        # Instead, now we popular the cache early in specific places in `innerCreateType`
        # typeCache[moduleIndex][typeIndex] = None
    
    result = innerCreateType(moduleIndex, typeIndex, withName, withNameIndex)
    typeCache[moduleIndex][typeIndex] = result
    return result

def innerCreateType(moduleIndex, typeIndex, withName = None, withNameIndex = None):
    # print(moduleIndex, typeIndex)
    module = modulesDict[moduleIndex]
    types = modulesTypesDict[moduleIndex]
    typeRoot = types[typeIndex]
    entryType = typeRoot['typeName']
    category = typeRoot['categoryName']
    nameOfType = typeRoot.get('name')

    if entryType == 'NAME':
        typeCache[moduleIndex][typeIndex] = None # these are immutable, so we can't create a "shell" early
        scopeCode = typeRoot['scope']
        scopeName = types[scopeCode]['name'] if scopeCode != 0 else None
        aliasFor = typeRoot['type']
        aliasForType = None

        # print('nameOfType is {} scope: {} aliasFor: {}'.format(nameOfType, scopeName, aliasFor))

        if scopeName is None or scopeName == 'struct':
            # typeRootForAliasFor = types[aliasFor]
            # print(typeRootForAliasFor)
            #if typeRootForAliasFor['typeName'] != 'NAME':
            aliasForType = createType(moduleIndex, aliasFor, withName=nameOfType, withNameIndex=typeIndex)
            #else:
            #    print("warning: typeIndex {} nameOfType {} points to {} ".format(typeIndex, nameOfType, typeRootForAliasFor))
        else:
            print('skipped due to scope: nameOfType is {} scope: {} aliasFor: {}'.format(nameOfType, scopeName, aliasFor))

        if aliasForType is not None:
            if scopeName is None:
                categoryPath = createTypeCategory('/' + module['name'])
                rv = TypedefDataType(categoryPath, nameOfType, aliasForType, dtm)

                # print('new type: ', rv)
                return dtm.addDataType(rv, DataTypeConflictHandler.REPLACE_HANDLER)
            else:
                # don't create a new global name for a struct/union/enum
                return aliasForType
    elif entryType == 'SCALAR':
        scalarSize = typeRoot['scalarTypeSizeInBytes']
        scalarCategory = typeRoot['scalarTypeClassName']
        if scalarCategory == 'void':
            return VoidDataType.dataType
        elif scalarCategory == 'int':
            return AbstractIntegerDataType.getSignedDataType(scalarSize, dtm)
        elif scalarCategory == 'unsigned':
            return AbstractIntegerDataType.getUnsignedDataType(scalarSize, dtm)
        elif scalarCategory == 'float':
            return AbstractFloatDataType.getFloatDataType(scalarSize, dtm)
        elif scalarCategory == 'complex':
            return AbstractComplexDataType.getComplexDataType(scalarSize, dtm)
    elif category == 'POINTER':
        baseTypeCode = typeRoot['baseType']
        baseLocator = typeRoot.get('baseLocator') # todo
        if baseLocator is not None:
            print('unhandled baseLocator! {}'.format(baseLocator))

        baseType = createType(moduleIndex, baseTypeCode)
        if baseType is not None:
            return Pointer32DataType(baseType)
        else:
            print("pointer: failed to get base type! pointer type: {} base type: {}".format(typeRoot, types[baseTypeCode]))
        # print('pointer: ', baseTypeCode, baseLocator)
    elif entryType == 'ARRAY_BYTE_INDEX' or entryType == 'ARRAY_WORD_INDEX' or entryType == 'ARRAY_LONG_INDEX':
        baseTypeCode = typeRoot['baseType']
        highBound = typeRoot['highBound']
        baseType = createType(moduleIndex, baseTypeCode)
        if baseType is not None:
            return ArrayDataType(baseType, highBound + 1)
        # print('array type:', baseTypeCode, highBound)
    elif entryType == 'STRUCTURE_LIST':
        categoryPath = createTypeCategory('/' + module['name'] + '/struct')
        structName = withName if withName is not None else "unnamed_struct_{}".format(typeIndex)
        structBytes = typeRoot.get('size', 0)
        struct = StructureDataType(categoryPath, structName, structBytes)
        struct = dtm.addDataType(struct, DataTypeConflictHandler.REPLACE_HANDLER)
        typeCache[moduleIndex][typeIndex] = struct # update cache now, in case some field is a pointer to us
        if withNameIndex is not None:
            typeCache[moduleIndex][withNameIndex] = struct # prevent infinite recursion

        for f in typeRoot['fields']:
            fieldDataType = createType(moduleIndex, f['type'])
            if fieldDataType is not None:
                try:
                    if f['typeName'].startswith("STRUCTURE_FIELD"):
                        struct.replaceAtOffset(f['offset'], fieldDataType, -1, f['name'], None)
                    elif f['typeName'].startswith("STRUCTURE_BIT"):
                        # startBit, bitSize
                        # byteoffset, byteWidth, bitOffset, datatype, bitsize, name, comment
                        struct.insertBitFieldAt(f['offset'], fieldDataType.getLength(), f['startBit'], fieldDataType, f['bitSize'], f['name'], None)
                    else:
                        print('unhandled subtype! {}'.format(f['typeName']))
                except:
                    print('Exception! Failed to add subtype! {}'.format(f))
            else:
                print('warning: failed to add field {}: could not get type. field: {} type: {}'.format(f['name'], f, types[f['type']]))

        return struct
    elif entryType == 'PROCEDURE_NEAR386':
        categoryPath = createTypeCategory('/' + module['name'])
        funcName = withName if withName is not None else "unnamed_funcptr_{}".format(typeIndex)
        func = FunctionDefinitionDataType(categoryPath, funcName)
        func = dtm.addDataType(func, DataTypeConflictHandler.REPLACE_HANDLER)
        typeCache[moduleIndex][typeIndex] = func # update cache now, in case some field is a pointer to us
        if withNameIndex is not None:
            typeCache[moduleIndex][withNameIndex] = func # prevent infinite recursion

        returnType = createType(moduleIndex, typeRoot['retType'])
        paramTypes = [createType(moduleIndex, paramType) for paramType in typeRoot['paramTypes']]

        #   print("returnType: {}, paramTypes: {}".format(returnType, paramTypes))
        func.setReturnType(returnType)
        for i in range(len(paramTypes)):
            paramType = paramTypes[i]
            # print("foo: {}, {}".format(paramType, i))
            if paramType is not None and paramType != VoidDataType.dataType:
                try:
                    func.replaceArgument(i, None, paramType, None, SourceType.IMPORTED)
                except:
                    print('failed to replace arg! func: {} arg: {} type: {}'.format(func.getName(), i, paramType.getName()))
            elif paramType is None:
                print('func {} arg {} type is None'.format(func.getName(), i))

        return func

    # elif entryType.startswith('STRUCTURE_FIELD') or entryType.startswith('STRUCTURE_BIT'):
        # this one is weird. We process these the normal way in the STRUCTURE_LIST arm.
        # this block is for when there's something referring to a struct field instead
        # of the struct list. Not sure what that means. For now, just defer to the base type

        # this was all a bug, these don't even get index numbers!
    #    return createType(moduleIndex, typeRoot['type'], withName=typeRoot['name'], withNameIndex=typeIndex)
        
    else:
        print('unhandled entryType: ', entryType)
        return None
    
    print('partly handled entryType: {}'.format(entryType))
    return None
    

groupIntoFragments()

functionManager = currentProgram.getFunctionManager()

for local in modulesLocals:
    # print('local is: ' + str(local))
    moduleIndex = local['meta']['moduleIndex']
    baseAddr = None
    func = None
    blockParentOffset = None        
    blockSize = None
    returnAddressOffset = None

    for entry in local['entries']:
        # print(entry)
        if entry["typeName"] == 'MODULE386':
            newType = createType(moduleIndex, entry['typeIndex'])
            memoryBlock = getMemoryBlockFromSegment(entry['segment'])
            address = getAddressFromSegment(entry['segment'], entry['location'])
            createLabel(address, entry['symbolName'], False, SourceType.IMPORTED)
            if newType is not None:
                try:
                    # print("assigning type: {}: {}".format(entry['symbolName'], newType.getName()))
                    listing.createData(address, newType)
                except CodeUnitInsertionException as e:
                    # print(e)
                    pass
        elif entry["typeName"] == 'SET_BASE386':
            baseAddr = getAddressFromSegment(entry['segment'], entry['location'])
        elif entry['typeName'] == 'NEAR_RTN_386' or entry['typeName'] == 'FAR_RTN_386' or entry['typeName'] ==  'NEAR_RTN' or entry['typeName'] == 'FAR_RTN':
            blockParentOffset = None
            blockSize = None
            # startOffset, size, parentBlockOffset, returnAddressOffset, typeIndex, returnValueLocation
            # numberOfPregisterParams, registerParams, symbolName

            name = entry['symbolName']
            size = entry['size']
            registerParams = entry.get('registerParams', [])
            returnValueLocation = entry.get('returnValueLocation', [])[0]
            returnAddressOffset = entry.get('returnAddressOffset', 0)
            address = baseAddr.add(entry['startOffset'])
            func = functionManager.getFunctionAt(address)
            
            if func is not None:
                old_name = func.getName()
                func.setName(name, SourceType.IMPORTED)
                print("Renamed function {} to {} at address {}".format(old_name, name, address))
            else:
                func = functionManager.createFunction(name, address, AddressSet(address, address.add(size - 1)), SourceType.IMPORTED)
                print("Created function {} at address {}".format(name, address))

            returnType = None
            functionDataType = None
            try:
                functionDataType = createType(moduleIndex, entry['typeIndex'], withName=name)
                returnType = functionDataType.getReturnType()
                if returnValueLocation['lsmName'] == 'UNKNOWN':
                    func.setReturnType(returnType, SourceType.IMPORTED)    
                else:
                    if returnValueLocation['lsmName'] == "MULTI_REG":
                        func.setCustomVariableStorage(True)
                        regName = returnValueLocation['registerNames'][0]
                        reg = currentProgram.getRegister(regName)
                        varStorage = VariableStorage(currentProgram, reg)
                        try:
                            func.setReturn(returnType, varStorage, SourceType.IMPORTED)
                        except:
                            print('failed to set function return type')
                            pass

            except:
                pass                
            
            if len(registerParams) > 0:
                func.setCustomVariableStorage(True)

            fdtArgs = functionDataType.getArguments()
            varStorageParams = []
            for i in range(max(len(registerParams), len(fdtArgs))):
                if i < len(registerParams):
                    registerParam = registerParams[i][0]
                
                    if registerParam['lsmName'] == "MULTI_REG":
                        regName = registerParam['registerNames'][0]
                        reg = currentProgram.getRegister(regName)
                        varStorage = VariableStorage(currentProgram, reg)
                        if i < len(fdtArgs):
                            paramType = fdtArgs[i].getDataType()
                        else:
                                paramType = Undefined.getUndefinedDataType(reg.getNumBytes())
                        param = ParameterImpl(None, paramType, varStorage, currentProgram)
                        varStorageParams.append(param)
                else:
                    param = ParameterImpl(None, fdtArgs[i].getDataType(), None, currentProgram)
                    varStorageParams.append(param)

            func.replaceParameters(varStorageParams, Function.FunctionUpdateType.CUSTOM_STORAGE, True, SourceType.IMPORTED)
            # func.updateFunction(Function.UpdateType.CUSTOM_STORAGE, True, SourceType.IMPORTED, varStorageParams)
        elif entry['typeName'] == 'LOCAL':
            if func is not None:
                symbolName = entry['symbolName']
                location = entry['location'][0]
                datatypeIndex = entry['typeIndex']
                
                if location['lsmName'].startswith('BP_OFFSET'):
                    offset = location['offset']
                    # add `returnAddressOffset` to `offset` because ghidra uses the ESP and not EBP!
                    # and by "add" I mean "subtract" since these are all negative
                    if returnAddressOffset is not None:
                        offset = offset - returnAddressOffset

                    #if dataType.getLength() > 0:
                    #    storage = VariableStorage(currentProgram, offset, dataType.getLength())
                    #    var = LocalVariableImpl(symbolName, 0, dataType, storage, True, currentProgram, SourceType.IMPORTED)
                    #else:
                    try:
                        localDataType = createType(moduleIndex, datatypeIndex)
                        var = LocalVariableImpl(symbolName, localDataType, offset, currentProgram, SourceType.IMPORTED)
                        # if blockParentOffset is not None:
                        # turns out this isn't allowed for stack variables
                        #    var.setFirstUseOffset(blockParentOffset)
                        try:
                            func.addLocalVariable(var, SourceType.IMPORTED)
                        except DuplicateNameException:
                            var.setName('{}_{:08x}'.format(symbolName, offset), SourceType.IMPORTED)
                            func.addLocalVariable(var, SourceType.IMPORTED)

                    except:
                        print('exception! failed to add var {} to func {}'.format(symbolName, func.getName()))
                        print(sys.exc_info())
                elif location['lsmName'] == "CONST_ADDR386":
                    localDataType = createType(moduleIndex, entry['typeIndex'])
                    address = getAddressFromSegment(location['constSegment'], location['constAddress'])

                    var = LocalVariableImpl(symbolName, 0, localDataType, address, currentProgram, SourceType.IMPORTED)
                    if blockParentOffset is not None:
                        var.setFirstUseOffset(blockParentOffset)
                    func.addLocalVariable(var, SourceType.IMPORTED)
                    
                else:
                    print('local: unhandled location {} for local for func {}'.format(location, func.getName()))

        elif entry['typeName'] == "BLOCK_386" or entry['typeName'] == "BLOCK":
            # blocks can also have LOCALs, make sure we don't treat it as the last func we saw!
            # todo: enhance to look up contained function
                        # "typeName": "BLOCK_386",
                        # "startOffset": 76,
                        # "size": 93,
                        # "parentBlockOffset": 304
            func = None
            address = baseAddr.add(entry['startOffset'])
            endAddress = address.add(entry['size'])
            createLabel(address, 'block_start_{:08x}'.format(entry['startOffset']), False)
            createLabel(endAddress, 'block_end_{:08x}'.format(entry['startOffset']), False)
            func = functionManager.getFunctionContaining(address)
            if func is None:
                print('BLOCK_386: cannot find func at {}'.format(address))
            else:
                blockParentOffset = entry['parentBlockOffset']
                blockSize = entry['size']
                print('BLOCK_386: found func {} at address {}'.format(func.getName(), address))

        else:
            print("unhandled local entry: {}".format(entry['typeName']))


def processGlobalSymbolsTable():
    for g in globalSymbolsTable:
        # for some reason bools aren't getting parsed out of the JSON correctly...
        addressOffset = g['addressOffset']
        addressSegment = g['addressSegment']

        name = g['name'].encode('utf-8')

        address = getAddressFromSegment(addressSegment, addressOffset)
        kind = 'data'
        if name.endswith('_'):
            name = name[:-1]
            kind = 'code'
        elif name.startswith('_'):
            name = name[1:]
        
        
        if kind == 'data':
            createLabel(address, name, False)
        else:
            func = functionManager.getFunctionAt(address)

            if func is not None:
                old_name = func.getName()
                if old_name != name:
                    func.setName(name, SourceType.IMPORTED)
                    print("Renamed function {} to {} at address {}".format(old_name, name, address))
            else:
                func = createFunction(address, name)
                print("Created function {} at address {}".format(name, address))

processGlobalSymbolsTable()

