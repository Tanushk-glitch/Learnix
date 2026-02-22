create database university;

use university;

create table dept(
    dept_id int auto_increment primary key,
    dept_name varchar(50) not null unique
);

create table students(
  id int auto_increment primary key,
    name varchar(200) not null,
    email varchar(100) not null unique,
    password varchar(255) not null,
    gender varchar(10) not null,
    phone_no varchar(15) not null,
    address varchar(255),
    dob date,
    dept_id int,
    foreign key (dept_id) references dept(dept_id)

);


create table teacher(
    teacher_id int auto_increment primary key,
    name varchar(200) not null,
    email varchar(100) not null unique,
    password varchar(255) not null,
    phone_no varchar(15) not null,
    dept_id int,
    foreign key (dept_id) references dept(dept_id)

);


create table courses(
    course_id int auto_increment primary key,
    course_name varchar(100) not null,
    credits int not null,
    dept_id int,
    foreign key (dept_id) references dept(dept_id),
    teacher_id int,
    foreign key (teacher_id) references teacher(teacher_id)
);

create table enrollment(
    enrollment_id int auto_increment primary key,
    grade varchar(2),
    enrollment_date date,
    student_id int,
    foreign key (student_id) references students(id),
    course_id int,
    foreign key (course_id) references courses(course_id)
);