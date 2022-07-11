import AWS  from 'aws-sdk';
import { performance } from 'node:perf_hooks';
import stream from "stream";
import yauzl from "yauzl";

AWS.config.loadFromPath('aws-config.json');

const s3 = new AWS.S3({
    // endpoint: endpoint,
    // accessKeyId: S3_KEY,
    // secretAccessKey: S3_SECRET,
    httpOptions: {timeout: 15000},
    maxRetries: 10
    });

// These settings come from request, but saved for tests    
const bucket: string = 'zip-unzip-bucket'
const fileKey: string = 'property.zip'

// Start timer
const startTime = performance.now()

/* Declare upload stream promise, sends datat with concurent upload mechanism  */
const uploadStream = ({ Bucket, Key }: any) => {      
  const pass = new stream.PassThrough();
  const uploadParams = { Bucket, Key, Body: pass }
  const options = {
    // Chunk size (5 Mb — is minimum)
    partSize: 5 * 1024 * 1024,
    // How many concurrent uploads
    queueSize: 24
    };  
  return {
    writeStream: pass,
    promise: s3.upload(uploadParams, options)
    .on("httpUploadProgress", (progress: any) => {
        let uploaded = (progress.loaded / 1024 /1024);
        let timeElapsed = (performance.now() - startTime) / 1000  // convert ms to seconds
        // console.log(process.memoryUsage())
        console.log("MEMORY used:", (process.memoryUsage().heapUsed / 1204 /1024).toFixed(4))
        console.log(`...progress [${progress.key}]: ${uploaded.toFixed(3)} MB, PART: ${progress.part} } Elapsed: ${timeElapsed.toFixed(6)} s`)
        })
    .promise(),
  };
};

/* Unzip file from buffer */
const extractZip = (Bucket: string, buffer: any) => {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(buffer, { lazyEntries: true }, function (err: Error, zipfile: any) {
      if (err) reject(err);
      zipfile.readEntry();
      
      // If more than one file
      zipfile.on("entry", function (entry: { fileName: string; }) {
        if (/\/$/.test(entry.fileName)) {
          // Directory entry
          // skip to the next entry
          zipfile.readEntry();
        } else {
          // Open read stream
          zipfile.openReadStream(entry, function (err: Error, readStream: any) {
            if (err) reject(err);
            const fileNames = entry.fileName;
            const { writeStream, promise } = uploadStream({
              Bucket: Bucket,
              Key: fileNames,
            });
            readStream.pipe(writeStream);
            promise.then(() => {
              console.log(entry.fileName + " Uploaded successfully!");
              zipfile.readEntry();
            });
          });
        }
      });
      zipfile.on("end", () => resolve("end"));
    });
  });
};

/* AWS handler */ 
exports.handler = async (event: any) => {
  console.log("Received event:", JSON.stringify(event, null, 2));

  // Get the object from the event
  const Bucket = event.bucket? event.bucket: bucket
  const Key = event.fileKey? event.fileKey : fileKey
  const params = { Bucket, Key }
  try { 
    console.log(`🔥  Read: ${Key} from ${Bucket}`)
    const object = await s3.getObject(params).promise();
    
    console.log(`🚀  Started unzip: ${Key}`)
    const result = await extractZip(Bucket, object.Body);
    
    // Return the report
    console.log(`Finished in ${((performance.now() - startTime) / 1000).toFixed(6)} s`)   
    return {
      status: result && 200,
      response: result && "OK",
    };
  } catch (err) {
    console.log(err);
    const message = `Error getting object ${Key} from bucket ${Bucket}. Make sure they exist and your bucket is in the same region as this function.`;
    console.log(message);
    throw new Error(message);
  }
};


/* ——————————— LOCAL TEST ————————————— */
// (async () => {
//     try {
//             const Bucket = bucket
//             const Key = fileKey
//             const params = { Bucket, Key };        
//             console.log(`🔥  Read: ${fileKey}`)
//             const object = await s3.getObject(params).promise();
//             console.log(`🔥  Started unzip: ${fileKey}`)
//             const result = await extractZip(bucket, object.Body);
//             let timeElapsed = (performance.now() - startTime) / 1000  // convert ms to seconds
//             console.log(`Finished in ${timeElapsed.toFixed(6)} s`) 
  

//             return {
//               status: result && 200,
//               response: result && "OK",
//             };
//           } catch (err) {
//             console.log(err);
//             const message = `Error getting object ${fileKey} from bucket ${bucket}. Make sure they exist and your bucket is in the same region as this function.`;
//             console.log(message);
//             throw new Error(message);
//           }

// })();