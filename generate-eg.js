import fs from 'fs';
import json2toml from 'json2toml';
json2toml({simple: true});
import path from 'path'

export async function generateEgFromPrisma(prismaGeneratedClientPath,outputFolderPath,egClientName) {
    const {PrismaClient} = await import(prismaGeneratedClientPath);
    const prisma = new PrismaClient()
    const dmmf = await prisma._getDmmf()
    const dmmfSchema = dmmf.datamodel.models
    const enums = dmmf.datamodel.enums

//Creating enumListObj from enums to include enums in filtered schema
    let enumListObj = {}

    for (let enumObj of enums) {
        let enumNameList = []
        for (let enumList of enumObj.values) {
            enumNameList.push(enumList.name)  
        }
        enumListObj[enumObj.name] = enumNameList
    }

//Creating filtered json schema from dmmfschema

    let eventsDic = {}
    //Function for parsing annotations to include custom annotations into jsonschema
    function parseAnnotations(string) {
        let words = string.replace(/@(\w+)/g, '$1').split(' ');
        const obj = {};
        for (let i = 0; i < words.length; i++) {
        const word = words[i];
        if (word.includes("(false)")) {
            const key = word.split("(")[0].trim();
            obj[key] = false;
        } else if (word.includes("(true)")) {
            const key = word.split("(")[0].trim();
            obj[key] = true;
        } else {
            obj[word] = true;
        }
        }
        return obj
    }

    //Function to generate filtered schema from dmmf schema
    function filterDmmfSchema(dmmfSchema,eventsDic) {
        for (let model of dmmfSchema) {
            let eventDic = {}
            for (let field of model.fields) {
                let a = field.type 
                if (a == 'Int') {
                    a = 'Number'
                }
                if (a == 'DateTime') {
                    a = 'Date'
                }
                if (field.kind === 'object') {
                    a = 'Object'
                }
                if (field.kind === 'enum') {
                    a = 'String'
                    eventDic['enum'] = enumListObj[field.type]
                }
                if(field.hasOwnProperty('documentation')) {
                    let docu = field['documentation']
                    let incDenorm = docu.includes('denormalize')
                    if (incDenorm === false) {
                        let docuObj = parseAnnotations(docu)
                        eventDic[field.name] = {type:a,...docuObj}
                    }
                }
                else {eventDic[field.name] = {type:a}}
            }    
            eventsDic[model.name] = eventDic
        } 
        return eventsDic
    }
    let filteredSchema = filterDmmfSchema(dmmfSchema,eventsDic)

    //Function to convert the filteredschema into jsonschema
    function jsonToToml(jsonData) {
        for (let key in jsonData) {
            if (jsonData.hasOwnProperty(key)) {
              const value = jsonData[key];
              let toml = json2toml( 
               value
                , {indent: 2, newlineAfterSection: true}
              )
              const folderPath = path.join(outputFolderPath, egClientName, 'schema', 'entities');
              if (!fs.existsSync(folderPath)) {
                fs.mkdirSync(folderPath, { recursive: true });
            }
                const filePath = path.join(folderPath, `${key.toLowerCase()}.toml`);
                fs.writeFileSync(filePath, toml);
            }
          }
    }
    jsonToToml(filteredSchema);

//Generating relationship.txt from dmmf schema by 

    let oneToOne = []
    let oneToOneFinal = []
    let oneToMany = []
    let oneToManyFinal = []
    let manyToMany = []

    //function to filter all the relations from prisma schema
    function filterRelations(relationSchema) {
        for (let models of relationSchema) {
            let a = models
            for (let model of models.fields) {
                if (model.hasOwnProperty('relationName') && models.primaryKey === null && model.isList === false) {
                    oneToOne.push(model.relationName);
                } 
                if (model.hasOwnProperty('relationName') && models.primaryKey === null && model.isList === true) {
                    oneToMany.push(model.relationName);
                }
                if (model.hasOwnProperty('relationName') && models.primaryKey !== null ) {
                    manyToMany.push(model.relationName);
                }
            }
        }
    }
    filterRelations(dmmfSchema)
    //removing duplicates
    if (oneToOne.length >=1) {
        oneToOneFinal = oneToOne.filter((value, index) => oneToOne.indexOf(value) !== index);
    }

    if (oneToMany.length >=1) {
        oneToManyFinal = oneToMany.filter((value) => !manyToMany.includes(value));
    }

    let finalFormattedString = ''

    //Functions to convert string to toml format
    function manyTomanyFun(inputString) {
        const words = inputString.split('To');
        let formattedString = `${words[0]}s <> ${words[1]}s
        [${words[1]}] <> [${words[0]}]
            `;
        finalFormattedString = finalFormattedString+'\n'+formattedString.toLocaleLowerCase();
        return finalFormattedString
    }

    function oneToManyFun(inputString) {
        const words = inputString.split('To');
        let formattedString = `${words[0]}s <> ${words[1]}
        ${words[1]} <> [${words[0]}]
            `;
        finalFormattedString = finalFormattedString+'\n'+formattedString.toLocaleLowerCase();
        return finalFormattedString
    }

    function oneToOneFun(inputString) {
        const words = inputString.split('To');
        let formattedString = `${words[0]} <> ${words[1]}
        ${words[1]} <> ${words[0]}
            `;
        finalFormattedString = finalFormattedString+'\n'+formattedString.toLocaleLowerCase();
        return finalFormattedString
    }


    if (oneToOneFinal.length >=1) {
        for (let one of oneToOneFinal ) {
            oneToOneFun(one)
        }
    }
    if (oneToManyFinal.length >=1) {
        for (let one of oneToManyFinal ) {
            oneToManyFun(one)
        }
    }
    if (manyToMany.length >=1) {
        for (let one of manyToMany ) {
            manyTomanyFun(one)
        }
    }
    const folderPath = path.join(outputFolderPath, egClientName, 'schema');
    const filePath = path.join(folderPath, `relationships.txt`);
    fs.writeFileSync(filePath, finalFormattedString);

//Creating index.toml in joins folder 

    //Parsing denormalize annotation
    function parseDenormalizeAnnotations(string) {
        const cleanedString = string.replace("denormalize:", "");
        const jsonFormattedString = cleanedString.replace(/'/g, '"');
        const array = JSON.parse(jsonFormattedString);
        return array
    }
    //Filtering dmmf schema for annotations 
    function filterDmmfSchemaForDenormalization(dmmfSchema) {
        let joinsObj = {};
        for (let model of dmmfSchema) {
            for (let field of model.fields) {
                if(field.hasOwnProperty('documentation')) {
                    let docu = field['documentation']
                    if (docu.includes('denormalize')) {
                        let joinObj = {}
                        let docuList = []
                        docuList = parseDenormalizeAnnotations(docu)
                        joinObj[field.name] = docuList
                        if (joinsObj.hasOwnProperty(model.name)){
                            joinsObj[model.name] = {...joinsObj[model.name],...joinObj}
                        } else {
                                joinsObj[model.name] = joinObj
                        }
                    }
                    
                }
            }    
        } 
        return joinsObj
    }
    let filteredJoinsSchema = filterDmmfSchemaForDenormalization(dmmfSchema)

    //Converting jsonSchema to join syntax
    function joinSynFrmObj(object) {
        let str = ''
        for (let keys in object) {
            let value = object[keys]
            for (let key of value) {
                if (key.includes('.')) {
                    const words = key.split('.');
                    const result = words.join('{')+'}';
                    str = `${str}
                    ${keys}.${result}`
                }
                else {
                    str = `${str}
                    ${keys}.{${key}}`
                }
            }
        }
        return str
    }

    function joinsDicToJoinTxt(filteredJoinsSchema) {
        let reqStr = ''
        for (let joinObj in filteredJoinsSchema) {
            if (filteredJoinsSchema.hasOwnProperty(joinObj)) {
                const values = filteredJoinsSchema[joinObj]
                for (let value in values) {
                    if (values.hasOwnProperty(value)) {
                            let str = joinSynFrmObj(values)
                            if (reqStr.includes(str) === false){
                                reqStr =`${reqStr}[${joinObj.toLocaleLowerCase()}]${str}`+ '\n'     
                            }
                    }
                }
            }
        }
        return reqStr
    }

    const joinsStr = joinsDicToJoinTxt(filteredJoinsSchema)              
    const joinsFolderPath = path.join(outputFolderPath, egClientName,  'joins');
    if (!fs.existsSync(joinsFolderPath)) {
        fs.mkdirSync(joinsFolderPath, { recursive: true });
    const joinsFilePath = path.join(joinsFolderPath, `index.txt`);
    fs.writeFileSync(joinsFilePath, joinsStr);
    }
//Generating Elasticsearch.toml file

    const config = prisma._engineConfig
    const reqDetails = config.generator.config
    let allStr = ''
    for (let each in reqDetails) {
        let str = ''
        str = `${each} = ${reqDetails[each]}`+'\n'
        allStr += str
    }
    const elasticsearchFolderPath = path.join(outputFolderPath, egClientName);
    const elasticsearchFilePath = path.join(elasticsearchFolderPath, `elasticsearch.toml`);
    fs.writeFileSync(elasticsearchFilePath, allStr);

}

// generateEgFromPrisma('./generated-clients/postgres/index.js','./src/datasources/eg_config','prisma-eg-1');