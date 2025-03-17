from flask import Flask, render_template, request, redirect, url_for, session, flash
from flask_sqlalchemy import SQLAlchemy
from werkzeug.security import generate_password_hash, check_password_hash
import os
import re
from datetime import datetime, timedelta
import secrets
from functools import wraps

basedir = os.path.abspath(os.path.dirname(__file__))
db_path = os.path.join(basedir, "instance", "employee.db")

app = Flask(__name__)
app.config["SQLALCHEMY_DATABASE_URI"] = f"sqlite:///{db_path}"
app.config["SECRET_KEY"] = secrets.token_hex(16)
app.config["PERMANENT_SESSION_LIFETIME"] = timedelta(hours=24)

db = SQLAlchemy(app)

class Employee(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(80), unique=True, nullable=False)
    password_hash = db.Column(db.String(256), nullable=False)
    fullname = db.Column(db.String(120), nullable=False)
    position = db.Column(db.String(50), nullable=False)
    email = db.Column(db.String(120), unique=True, nullable=False)
    phone = db.Column(db.String(10), nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    last_login = db.Column(db.DateTime)

    def set_password(self, password):
        self.password_hash = generate_password_hash(password)

    def check_password(self, password):
        return check_password_hash(self.password_hash, password)

class Product(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(200), nullable=False)
    description = db.Column(db.Text)
    price = db.Column(db.Float, nullable=False)
    stock = db.Column(db.Integer, default=0)
    category = db.Column(db.String(50))
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

class Sale(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    product_id = db.Column(db.Integer, db.ForeignKey("product.id"), nullable=False)
    employee_id = db.Column(db.Integer, db.ForeignKey("employee.id"), nullable=False)
    quantity = db.Column(db.Integer, nullable=False)
    total_price = db.Column(db.Float, nullable=False)
    sale_date = db.Column(db.DateTime, default=datetime.utcnow)
    product = db.relationship("Product", backref="sales")
    employee = db.relationship("Employee", backref="sales")

def validate_password(password):
    if len(password) < 8:
        return False, "รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร"
    if not re.search("[a-z]", password):
        return False, "รหัสผ่านต้องมีตัวพิมพ์เล็ก"
    if not re.search("[A-Z]", password):
        return False, "รหัสผ่านต้องมีตัวพิมพ์ใหญ่"
    if not re.search("[0-9]", password):
        return False, "รหัสผ่านต้องมีตัวเลข"
    return True, "รหัสผ่านปลอดภัย"

def login_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if "username" not in session:
            flash("กรุณาเข้าสู่ระบบก่อน", "error")
            return redirect(url_for("login"))
        return f(*args, **kwargs)
    return decorated_function

@app.route("/")
@login_required
def home():
    employee = Employee.query.filter_by(username=session["username"]).first()
    products = Product.query.all()
    recent_sales = Sale.query.order_by(Sale.sale_date.desc()).limit(5).all()
    return render_template("dashboard.html", employee=employee, products=products, recent_sales=recent_sales)

@app.route("/login", methods=["GET", "POST"])
def login():
    if request.method == "POST":
        username = request.form["username"]
        password = request.form["password"]
        employee = Employee.query.filter_by(username=username).first()
        if employee and employee.check_password(password):
            session["username"] = username
            session.permanent = True
            employee.last_login = datetime.utcnow()
            db.session.commit()
            flash("เข้าสู่ระบบสำเร็จ!", "success")
            return redirect(url_for("home"))
        else:
            flash("ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง!", "error")
    return render_template("login.html")

@app.route("/register", methods=["GET", "POST"])
def register():
    if request.method == "POST":
        username = request.form["username"]
        password = request.form["password"]
        confirm_password = request.form["confirm_password"]
        fullname = request.form["fullname"]
        position = request.form["position"]
        email = request.form["email"]
        phone = request.form["phone"]

        is_valid, msg = validate_password(password)
        if not is_valid:
            flash(msg, "error")
            return redirect(url_for("register"))

        if password != confirm_password:
            flash("รหัสผ่านไม่ตรงกัน!", "error")
            return redirect(url_for("register"))

        if Employee.query.filter_by(username=username).first():
            flash("ชื่อผู้ใช้นี้มีคนใช้แล้ว!", "error")
            return redirect(url_for("register"))

        if Employee.query.filter_by(email=email).first():
            flash("อีเมลนี้มีคนใช้แล้ว!", "error")
            return redirect(url_for("register"))

        new_employee = Employee(
            username=username,
            fullname=fullname,
            position=position,
            email=email,
            phone=phone
        )
        new_employee.set_password(password)
        
        db.session.add(new_employee)
        db.session.commit()
        flash("ลงทะเบียนสำเร็จ!", "success")
        return redirect(url_for("login"))
    return render_template("register.html")

@app.route("/products")
@login_required
def products():
    products = Product.query.all()
    return render_template("products.html", products=products)

@app.route("/product/add", methods=["GET", "POST"])
@login_required
def add_product():
    if request.method == "POST":
        new_product = Product(
            name=request.form["name"],
            description=request.form["description"],
            price=float(request.form["price"]),
            stock=int(request.form["stock"]),
            category=request.form["category"]
        )
        db.session.add(new_product)
        db.session.commit()
        flash("เพิ่มสินค้าสำเร็จ!", "success")
        return redirect(url_for("products"))
    return render_template("add_product.html")

@app.route("/product/edit/<int:id>", methods=["GET", "POST"])
@login_required
def edit_product(id):
    product = Product.query.get_or_404(id)
    if request.method == "POST":
        product.name = request.form["name"]
        product.description = request.form["description"]
        product.price = float(request.form["price"])
        product.stock = int(request.form["stock"])
        product.category = request.form["category"]
        db.session.commit()
        flash("อัพเดทสินค้าสำเร็จ!", "success")
        return redirect(url_for("products"))
    return render_template("edit_product.html", product=product)

@app.route("/product/delete/<int:id>")
@login_required
def delete_product(id):
    product = Product.query.get_or_404(id)
    db.session.delete(product)
    db.session.commit()
    flash("ลบสินค้าสำเร็จ!", "success")
    return redirect(url_for("products"))

@app.route("/sales")
@login_required
def sales():
    sales = Sale.query.order_by(Sale.sale_date.desc()).all()
    return render_template("sales.html", sales=sales)

@app.route("/sale/add", methods=["GET", "POST"])
@login_required
def add_sale():
    if request.method == "POST":
        product_id = int(request.form["product_id"])
        quantity = int(request.form["quantity"])
        product = Product.query.get_or_404(product_id)
        employee = Employee.query.filter_by(username=session["username"]).first()
        
        if product.stock < quantity:
            flash("สินค้าในสต็อกไม่เพียงพอ!", "error")
            return redirect(url_for("add_sale"))
        
        total_price = product.price * quantity
        new_sale = Sale(
            product_id=product_id,
            employee_id=employee.id,
            quantity=quantity,
            total_price=total_price
        )
        
        product.stock -= quantity
        db.session.add(new_sale)
        db.session.commit()
        flash("บันทึกการขายสำเร็จ!", "success")
        return redirect(url_for("sales"))
    
    products = Product.query.all()
    return render_template("add_sale.html", products=products)

@app.route("/logout")
def logout():
    session.pop("username", None)
    flash("ออกจากระบบสำเร็จ!", "success")
    return redirect(url_for("login"))

# สร้างฐานข้อมูลถ้ายังไม่มี
if not os.path.exists(os.path.dirname(db_path)):
    os.makedirs(os.path.dirname(db_path))

with app.app_context():
    if not os.path.exists(db_path):
        db.create_all()
        print(f"Database created at {db_path}")
    else:
        print(f"Using existing database at {db_path}")

if __name__ == "__main__":
    app.run(debug=True, host="0.0.0.0", port=5000)
