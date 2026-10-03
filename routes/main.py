from flask import Blueprint, jsonify, render_template

main_bp = Blueprint('main', __name__)

@main_bp.route('/healthz', methods=['GET'])
def health_check():
    return jsonify({'status': 'ok'}), 200

@main_bp.route('/')
def index():
    return render_template('Index.html')