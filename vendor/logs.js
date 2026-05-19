import fs from 'fs-extra'
import path from 'path'

var appDir = process.cwd();

console.log(appDir);

function curdate(minute){
    minute = (minute < 10) ? '0' + minute : minute;
    return minute;
}
  
export function mlog (par) {
    let datecreate = new Date();
    let texta = `\n ${curdate(datecreate.getHours())}:${curdate(datecreate.getMinutes())}:${curdate(datecreate.getSeconds())}`;
    let obj = arguments;
  
    for (const key in obj) {
      if (typeof obj[key]=='object') {
        for (const keys in obj[key]){
          texta = `${texta} \n ${keys}:${obj[key][keys]}`
        }
      } else {
        texta = `${texta} ${obj[key]}`
      }
      
    } 

    const logsDir = path.join(appDir, 'vendor', 'logs');
    if (!fs.existsSync(logsDir)) {
        fs.mkdirSync(logsDir);
    }

    fs.writeFileSync(path.join(logsDir, `${curdate(datecreate.getDate())}.${curdate(datecreate.getMonth()+1)} log.txt`),
    texta,
    {
      encoding: "utf8",
      flag: "a+",
      mode: 0o666
    });
  
    console.log(texta);
    return texta
}
