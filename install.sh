apt update 
echo OK!!  update
sleep 2
apt install npm -y 
echo OK!! npm
sleep 2
pip3 install smsactivateru
echo OK!!  smsactivateru
sleep 2
apt install -y make python build-essential
echo OK!! make python build-essential
sleep 2 
cp -r /root/shell-bot/sms.sh /bin/sms
echo OK!!  sms
sleep 2
cp -r /root/shell-bot/tel.sh /bin/tel
echo OK!! tel
sleep 2
npm install
echo OK!!  npm install
sleep 2
echo START SERVER CICADA3301
sleep 4
node server.js
