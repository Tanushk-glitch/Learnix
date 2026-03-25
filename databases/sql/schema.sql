create database university;

use university;

create table dept(
    dept_id int auto_increment primary key,
    dept_name varchar(50) not null unique
);

create table auth_users(
    id int auto_increment primary key,
    username varchar(100) not null,
    email varchar(150) not null unique,
    phone_no varchar(15) not null,
    role varchar(20) not null default 'student',
    dept_id int,
    password varchar(255) not null,
    created_at timestamp default current_timestamp,
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
    course_period varchar(100) null,
    dept_id int,
    foreign key (dept_id) references dept(dept_id),
    teacher_id int,
    foreign key (teacher_id) references teacher(teacher_id),
    video_path varchar(255) null
);

create table course_topics(
    topic_id int auto_increment primary key,
    course_id int not null,
    topic_name varchar(150) not null,
    topic_order int not null default 1,
    video_path varchar(255) not null,
    created_at timestamp default current_timestamp,
    updated_at timestamp default current_timestamp on update current_timestamp,
    unique key unique_course_topic (course_id, topic_name),
    foreign key (course_id) references courses(course_id) on delete cascade
);

create table course_topic_attendance(
    topic_attendance_id int auto_increment primary key,
    topic_id int not null,
    course_id int not null,
    auth_user_id int not null,
    marked_at timestamp default current_timestamp,
    unique key unique_topic_attendance (topic_id, auth_user_id),
    foreign key (topic_id) references course_topics(topic_id) on delete cascade,
    foreign key (course_id) references courses(course_id) on delete cascade,
    foreign key (auth_user_id) references auth_users(id) on delete cascade
);

create table enrollment(
    enrollment_id int auto_increment primary key,
    grade varchar(2),
    enrollment_date date,
    auth_user_id int,
    foreign key (auth_user_id) references auth_users(id),
    course_id int,
    foreign key (course_id) references courses(course_id)
);

create table student_performance(
    performance_id int auto_increment primary key,
    auth_user_id int not null,
    course_id int not null,
    attendance_pct decimal(5,2),
    marks_obtained int,
    marks_total int,
    focus_area varchar(255),
    updated_at timestamp default current_timestamp on update current_timestamp,
    foreign key (auth_user_id) references auth_users(id),
    foreign key (course_id) references courses(course_id)
);

insert into student_performance (auth_user_id, course_id, attendance_pct, marks_obtained, marks_total, focus_area)
select
    e.auth_user_id,
    e.course_id,
    82.50,
    76,
    100,
    concat('Focus on practice in ', c.course_name)
from enrollment e
join courses c on c.course_id = e.course_id
where not exists (
    select 1
    from student_performance p
    where p.auth_user_id = e.auth_user_id
      and p.course_id = e.course_id
);

