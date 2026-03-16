const fs = require('fs');

if (!fs.existsSync('./retos.db')) {

  const Datastore = require("nedb")

  const db = new Datastore({
    filename: "retos.db",
    autoload: true
  })


  var users = ['BJames', 'Mary', 'Michael', 'Patricia', 'John',
    'Jennifer', 'Robert', 'Linda', 'David', 'Elizabeth', 'William', 'Barbara',
    'Richard', 'Susan', 'Joseph', 'Jessica', 'Thomas', 'Karen', 'Christopher', 'Sarah'];

  users.sort(function (a, b) {
    return Math.random() - 0.5;
  });


  //---flag xss-----------------------------
  var j = 0;
  for (var i = 1; i < 6; i++) {

    flag = makeFlag(20)
    db.insert({
      id: i,
      flag: `Flisol{${flag}}`,
      category: "xss",
      inhabited: false,
      user: users[j]
    })
    j++;
  }
  //---flag csrf-----------------------------
  for (var i = 1; i < 6; i++) {
    flag = makeFlag(20)
    db.insert({
      id: i,
      flag: `Flisol{${flag}}`,
      category: "csrf",
      inhabited: false,
      user: users[j]
    })
    j++;
  }

  //---funcions-----------------------------


  function makeFlag(length) {
    var result = '';
    var characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    var charactersLength = characters.length;
    for (var i = 0; i < length; i++) {
      result += characters.charAt(Math.floor(Math.random() * charactersLength));
    }
    return result;
  }

}

if (!fs.existsSync('./rutas.db')) {

  const Datastore = require("nedb")

  const rutes = new Datastore({
    filename: "rutas.db",
    autoload: true
  })
}