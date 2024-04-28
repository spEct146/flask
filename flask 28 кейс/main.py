import g4f
from flask import Flask
from flask_restful import Api, Resource, reqparse

app = Flask(__name__)

api = Api()

def ask_gpt(promt: str)->str:
    responce = g4f.ChatCompletion.create(
        model = "gpt-3.5-turbo",
        messages = [{"role": "user","content": "Оцени разговор по пунктам: 1. Был ли вежлив менеджер при разговоре с клиентом 2. Смог ли менеджер решить запрос клиента 3. Какую оценку по шкале от 1 до 5 можно поставить менеджеру за этот звонок? 4. Как можно оценить разговор в сумме."}],
    )
    return responce
with open(f"0005.txt", 'r', encoding="utf8") as file:
    text = file.read()

textr = text.replace('n', ' ')
result = ask_gpt(textr)
phones = {
    1: {"audio": f"{textr}", "callScore": f"{result}"}
}

class Main(Resource):
    def get(self, ph_id):
        if ph_id == 0:
            return phones
        else:
            return phones[ph_id]

api.add_resource(Main, "/api/phones/<int:ph_id>")
api.init_app(app)

if __name__ == "__main__":
    app.run(debug=True, port= 3000, host="127.0.0.1")
