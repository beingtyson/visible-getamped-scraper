const chromium = require("chrome-aws-lambda");
const S3 = require("aws-sdk/clients/s3");
const axios = require("axios");
const gql = require("graphql-tag");
const graphql = require("graphql");
const fetch = require("node-fetch");

const endPoint = `https://43su3fyeyk.execute-api.ap-northeast-2.amazonaws.com/prod/graphql`;
const s3Url = `https://getamped.s3.ap-northeast-2.amazonaws.com`;
const s3 = new S3({
  params: {
    Bucket: "getamped",
  },
});

const getLastAccessory = gql`
  query FindFirstAccessory($orderBy: [AccessoryOrderByWithRelationInput!]) {
    findFirstAccessory(orderBy: $orderBy) {
      id
    }
  }
`;

const createAccessory = gql`
  mutation CreateManyAccessory($data: [AccessoryCreateManyInput!]!) {
    createManyAccessory(data: $data) {
      count
    }
  }
`;
exports.getAccessory = async () => {
  const browser = await chromium.puppeteer.launch();
  const page = await browser.newPage();
  const skipExplanation = 2;
  await page.setRequestInterception(true);

  const lastAccessoryId = await axios.post(endPoint, {
    query: graphql.print(getLastAccessory),
    variables: {
      orderBy: [
        {
          id: "desc",
        },
      ],
    },
  });
  if (!lastAccessoryId) return;

  page.on("request", (req) => {
    switch (req.resourceType()) {
      case "stylesheet":
      case "font":
      case "image":
        req.abort();
        break;
      default:
        req.continue();
        break;
    }
  });

  let pageNum = 1;
  let itemNo = 0;

  while (itemNo !== lastAccessoryId) {
    try {
      let accList = [];
      await page.goto(
        `http://getamped.juneinter.com/sub_main/menu/item/view/item_accessory.ws?page=${pageNum}&srch_type=item_name&srch=&order_type=regdate`
      );
      await page.waitForSelector("#t_chlist");

      const itemAccessoryList = await page.$$("#t_chlist tr");
      for (let idx = skipExplanation; idx < itemAccessoryList.length; idx++) {
        await page.goto(
          `http://getamped.juneinter.com/sub_main/menu/item/view/item_accessory.ws?page=${pageNum}&srch_type=item_name&srch=&order_type=regdate`
        );
        await page.waitForSelector("#t_chlist");
        const itemAccessoryList = await page.$$("#t_chlist tr");

        const itemInfo = await itemAccessoryList[idx].$$eval("td", (tdList) => {
          const no = parseInt(tdList[0].innerText);
          const regDate = tdList[5].innerText.trim();
          const itemImg = tdList[1].querySelector("a > img").src;
          const itemPrice = tdList[3].innerText.trim();
          const itemPriceType = tdList[3].querySelector("img")?.alt || "";
          const itemDetailLink = tdList[1].querySelector("a").href;
          return {
            no,
            regDate,
            itemImg,
            itemPrice,
            itemPriceType,
            itemDetailLink,
            itemCode: itemDetailLink.split("q=")[1],
          };
        });

        await page.goto(itemInfo.itemDetailLink);
        await page.waitForSelector(".f_title");

        const itemDetailInfo = await page.evaluate(() => {
          const itemName = document.querySelector(".f_title").innerText.trim();
          const itemStatImg = document.querySelector(".ex img")?.src;
          const detailDescription = document
            .querySelector("tbody")
            .children[4].innerText.trim();
          const detailCommand = document
            .querySelector("tbody")
            .children[6].innerText.trim();
          const availableCharacter = document
            .querySelector("tbody")
            .children[8].innerText.trim()
            .split("\n\n");

          return {
            itemName,
            itemStatImg,
            detailDescription,
            detailCommand,
            availableCharacter,
          };
        });

        const insertItem = { ...itemInfo, ...itemDetailInfo };

        accList.push({
          id: insertItem.no,
          code: insertItem.itemCode,
          regDate: insertItem.regDate,
          img: `${s3Url}/accessory/${insertItem.itemCode}.gif`,
          price: insertItem.itemPrice,
          priceType: insertItem.itemPriceType,
          name: insertItem.itemName,
          statImg: insertItem?.itemStatImg
            ? `${s3Url}/accessory/stat/${insertItem.itemCode}.gif`
            : "",
          detailDescription: insertItem.detailDescription,
          detailCommand: insertItem.detailCommand,
          availableCharacter: insertItem.availableCharacter,
        });

        await s3Upload(
          insertItem.itemImg,
          `accessory/${insertItem.itemCode}.gif`
        );
        if (insertItem.itemStatImg) {
          await s3Upload(
            insertItem.itemStatImg,
            `accessory/stat/${insertItem.itemCode}.gif`
          );
        }
        itemNo = insertItem.no;
      }

      await axios.post(endPoint, {
        query: graphql.print(createAccessory),
        variables: {
          data: accList,
        },
      });
      pageNum++;
    } catch (e) {
      console.log(e);
      break;
    }
  }

  await browser.close();
};

async function s3Upload(url, path) {
  const imgTest = await fetch(url);
  const blob = await imgTest.arrayBuffer();

  await s3
    .upload({
      Key: path,
      Body: new Uint8Array(blob),
    })
    .promise();
}
