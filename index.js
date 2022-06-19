const accessory = require("./accessory");
module.exports.handler = async (event, context) => {
  await accessory.getAccessory();
  return {
    statusCode: 200,
    body: JSON.stringify({
      message: "execute",
    }),
  };
};
