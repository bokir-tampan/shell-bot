import time
from smsactivateru import Sms, SmsTypes, SmsService, GetBalance, GetFreeSlots, GetNumber, SetStatus, GetStatus

"""
create wrapper with secret api-key
search here: http://sms-activate.ru/index.php?act=profile)
"""
wrapper = Sms('59f99Af3754fd7c9b5dA932840473d0A')
menu = """
   SMS-REG
➖➖➖➖➖➖➖
1️⃣	Telegram
➖➖➖➖➖➖➖
2️⃣	VkCom
➖➖➖➖➖➖➖
3️⃣	Whatsapp
➖➖➖➖➖➖➖
4️⃣	Viber
➖➖➖➖➖➖➖
5️⃣	OlxUA
➖➖➖➖➖➖➖
6️⃣	WOG
➖➖➖➖➖➖➖
⚙️	Нвстройка(X)
"""
goroda = """
'0' 🇷🇺
'1' 🇺🇦
'2' 🇰🇿
'3' 🇨🇳
'4' 🇵🇭
'5' 🇲🇲 
'6' 🇮🇩 
'7' 🇲🇾 
'8' 🇰🇪 
'9' 🇹🇿 
'10' 🇻🇳 
"""

print(menu)
print(goroda)

sr = int("Страна: ")



"""
    KG = '11'  # КЫРГЫЗСТАН (KYRGYZSTAN)
    US = '12'  # США (USA)
    IL = '13'  # ИЗРАИЛЬ (ISRAEL)
    HK = '14'  # ГОНКОНГ (HONG KONG)
    PL = '15'  # ПОЛЬША (POLAND)
    UK = '16'  # ВЕЛИКОБРИТАНИЯ/АНГЛИЯ (UNITED KINGDOM)
    MG = '17'  # МАДАГАСКАР (MADAGASCAR)
    CG = '18'  # КОНГО (CONGO)
    NG = '19'  # НИГЕРИЯ (NIGERIA)
    MO = '20'  # МАКАО (MACAU)
    EG = '21'  # ЕГИПЕТ (EGYPT)
    IE = '23'  # ИРЛАНДИЯ (IRELAND)
    KH = '24'  # КАМБОДЖА (CAMBODIA)
    LA = '25'  # ЛАОС (LAO)
    HT = '26'  # ГАИТИ (HAITI)
    CI = '27'  # КОТ Д'ИВУАР (RÉPUBLIQUE DE CÔTE D'IVOIRE)
    GM = '28'  # ГАМБИЯ (GAMBIA)
    RS = '29'  # СЕРБИЯ (SERBIAN)
    YE = '30'  # ЙЕМЕН (YEMEN)
    ZA = '31'  # ЮАР (SOUTH AFRICA)
    RO = '32'  # РУМЫНИЯ (ROMANIA)
    EE = '34'  # ЭСТОНИЯ (ESTONIA)
    AZ = '35'  # АЗЕРБАЙДЖАН (AZERBAIJAN)
    CA = '36'  # КАНАДА (CANADA)
    MA = '37'  # МАРОККО (MOROCCO)
    GH = '38'  # ГАНА (GHANA)
    AR = '39'  # АРГЕНТИНА (ARGENTINA)
    UZ = '40'  # УЗБЕКИСТАН (UZBEKISTAN)
    CM = '41'  # КАМЕРУН (CAMEROON)
    TG = '42'  # ЧАД (CHAD)
    DE = '43'  # ГЕРМАНИЯ (GERMANY)
    LT = '44'  # ЛИТВА (LITHUANIA)
    HR = '45'  # ХОРВАТИЯ ( CROATIA)
    IQ = '47'  # ИРАК (IRAQ)
    NL = '48'  # НИДЕРЛАНДЫ (NETHERLANDS)
"""
# getting balance
balance = GetBalance().request(wrapper)
# show balance
print('На счету {} руб.'.format(balance))

# getting free slots (count available phone numbers for each services)
available_phones = GetFreeSlots(
	country=SmsTypes.Country.sr
).request(wrapper)


# try get phone for youla.io
activation = GetNumber(
	service=SmsService().AnyOther,
	country=SmsTypes.Country.sr,
	
).request(wrapper)
# показать код активации и телефон для приема смс
print('phone: {}'.format(str(activation.id), str(activation.phone_number)))

# getting and show current activation status
response = GetStatus(id=activation.id).request(wrapper)
print(response)

# .. send phone number to you service
user_action = input('Нажмите ввод, если вам было отправлено смс, или введите «cancel»": ')
if user_action == 'cancel':
	set_as_cancel = SetStatus(
		id=activation.id,
		status=SmsTypes.Status.Cancel
	).request(wrapper)
	print(set_as_cancel)
	exit(1)

# set current activation status as SmsSent (code was sent to phone)
set_as_sent = SetStatus(
	id=activation.id,
	status=SmsTypes.Status.SmsSent
).request(wrapper)
print(set_as_sent)

# .. wait code
while True:
	time.sleep(1)
	response = GetStatus(id=activation.id).request(wrapper)
	if response['code']:
		print('Ваш код:{}'.format(response['code']))
		break

# set current activation status as End (you got code and it was right)
set_as_end = SetStatus(
	id=activation.id,
	status=SmsTypes.Status.End
).request(wrapper)
print(set_as_end)
