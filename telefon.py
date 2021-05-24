#!/usr/bin/python
# -*- coding: utf-8 -*-
import sys
import requests
import json
import time
import urllib
import os




class config:
	key = "3c742a205217b96571c24800e5d011e2" 
	       
def banner():
	os.system('clear')


def main():
	banner()
	if len(sys.argv) == 1:
		number = input("\n 📱 Номер телефона с префиксом  :")
		api = "http://apilayer.net/api/validate?access_key=" + config.key + "&number=" + number + "&country_code=&format=1"
		output = requests.get(api)
		content = output.text
		obj = json.loads(content)
		country_code = obj['country_code']
		country_name = obj['country_name']
		location = obj['location']
		carrier = obj['carrier']
		line_type = obj['line_type']

		print( "✅ Сбор информации о номере телефона 📱 ")
		print( "--------------------------------------")
		time.sleep(0.2)
 
		if country_code == "":
			print(" - Получение страны		  [ ❌ ]")
		else:
			print(" - Получение страны		  [ ✅ ]")

		time.sleep(0.2)
		if country_name == "":
			print(" - названия страны		  [ ❌ ]")
		else:
			print(" - названия страны		  [ ✅ ]")

		time.sleep(0.2)
		if location == "":
			print(" - местоположения		  [ 📴 ]")
		else:
			print( " - местоположения		  [ ✅ ]")

		time.sleep(0.2)
		if carrier == "":
			print(" - Получение провайдера	   	  [ ❌ ]")
		else:
			print(" - Получение провайдера	   	  [ ✅ ]")

		time.sleep(0.2)
		if line_type == None:
			print(" - Получение устройства	    	  [ ❌ ]")
		else:
			print(" - Получение устройства	    	  [ ✅ ]")

		
		print("📌 Вывод информации 📌")
		print("--------------------------------------")
		print( " - Телефонный номер 📲: " + str(number))
		print(" - Страна 🏴‍☠️: " + str(country_code))
		print(" - Country Name 🏙: " + str(country_name))
		print( " - Расположение 🌍: " + str(location))
		print( " - провайдер 📡: " + str(carrier))
		print(" - устройства 📞: " + str(line_type))
	else:
		print("🆘 Ошибка 🆘")


main()
